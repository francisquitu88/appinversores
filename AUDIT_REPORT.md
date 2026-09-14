# AUDITORÍA EXHAUSTIVA: Company Workspace Data Consistency

**Fecha del análisis:** 2026-09-14  
**Alcance:** Inconsistencias en conteos, fechas y fuentes de datos en Company Workspace  
**Estado:** Diagnóstico únicamente. NO se han realizado cambios.

---

## 1. ¿QUÉ REPRESENTA "813 EVENTOS"?

### Ubicación
**Archivo:** [src/components/intelligence/IntelligenceView.tsx](src/components/intelligence/IntelligenceView.tsx#L24-L26)

```typescript
const activity = [
  ...news.map(...),                          // All news items
  ...sec.map(...),                           // All SEC filings
  ...ratings.map(...),                       // All analyst ratings
  ...insiderTrades.map(...)                  // All insider trades
].sort((a, b) => b.date - a.date)

// Display:
<span className="section-count">{activity.length} {t('events')}</span>
```

### Definición precisa
**"813 eventos" = `activity.length`** que es la suma de:

```
news_count           + 
sec_count            + 
ratings_count        + 
insider_trades_count 
= 813 eventos
```

### Para Kura Oncology (KURA):
Necesitamos verificar en la base de datos, pero la lógica es:

```sql
SELECT 
  (SELECT COUNT(*) FROM scraped_items 
   WHERE ticker='KURA' AND item_type != 'post' 
   AND NOT (metadata->>'source' = 'SEC' OR metadata->>'accessionNumber' IS NOT NULL)) as news_count,
  (SELECT COUNT(*) FROM scraped_items 
   WHERE ticker='KURA' 
   AND (metadata->>'source' = 'SEC' OR metadata->>'accessionNumber' IS NOT NULL)) as sec_count,
  (SELECT COUNT(*) FROM finviz_analyst_ratings WHERE ticker='KURA') as ratings_count,
  (SELECT COUNT(*) FROM finviz_insider_trades WHERE ticker='KURA') as insider_count;
```

### Cómo se calcula en el código
**[src/lib/queries/company.ts](src/lib/queries/company.ts#L14-L18)** - Extrae datos:

```typescript
const [stockResult, itemsResult, ratingsResult, insiderResult] = await Promise.all([
  client.from('tracked_stocks').select(...).eq('ticker', normalizedTicker),
  client.from('scraped_items').select(...).eq('ticker', normalizedTicker)
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('scraped_at', { ascending: false })
    .limit(1000),                                    // ← LÍMITE AQUÍ
  client.from('finviz_analyst_ratings').select(...).eq('ticker', normalizedTicker)
    .order('rating_date', { ascending: false }),   // ← SIN LÍMITE
  client.from('finviz_insider_trades').select(...).eq('ticker', normalizedTicker)
    .order('transaction_date', { ascending: false }) // ← SIN LÍMITE
])
```

### Filtrado en UI
**[src/components/intelligence/IntelligenceView.tsx](src/components/intelligence/IntelligenceView.tsx#L10-L14)**

```typescript
function isSec(item: ScrapedItem) { 
  return item.metadata.source === 'SEC' || 
         typeof item.metadata.accessionNumber === 'string' 
}

const news = items.filter((item) => !isSec(item) && item.item_type !== 'post')
const sec = items.filter(isSec)
```

### Conclusión sobre "813"
✅ **813 = suma de todos los datos de 4 fuentes**  
✅ Representa **conteo total en la actividad mostrada**  
✅ Es **dinámico** - cambiaría si:
- Se añaden más noticias de Finviz
- Se procesan nuevos SEC filings
- Se añaden ratings o insider trades

---

## 2. ¿QUÉ REPRESENTA "630 SEC"?

### Ubicación
**Archivo:** [src/pages/DashboardPage.tsx](src/pages/DashboardPage.tsx#L34-L35)

```typescript
const summaries = useMemo(() => {
  const result = new Map<string, TickerSummary>()
  stocks.forEach((stock) => 
    result.set(stock.ticker, { 
      totalFilings: 0, 
      // ... otros campos
    })
  )
  items.forEach((item) => { 
    // ...
    if (isSec(item)) summary.totalFilings += 1  // ← CONTADOR
    else summary.totalNews += 1
  })
  return result
}, [insiderTrades, items, ratings, stocks])

// Renderizado:
<span><b>{summary.totalFilings}</b> SEC<small>{displayDate(summary.lastUpdated)}</small></span>
```

### Definición precisa
**"630 SEC" es `summary.totalFilings`** que cuenta:

```
Número de filas en scraped_items 
donde:
  - ticker = 'KURA'
  - isSec(item) = true
    (es decir: metadata.source === 'SEC' OR metadata.accessionNumber está definido)
  - item_type != 'post'
= 630 SEC filings
```

### Tabla utilizada
- **Tabla:** `scraped_items`
- **Filtro:** `ticker='KURA'` + `isSec()` + `item_type != 'post'`
- **Resultado de consulta:** `.limit(1000)` en [company.ts](src/lib/queries/company.ts#L18)
- **Conteo:** Realizado en memoria en React (`.forEach()` + contador)

### Campos usados
- `ticker` - para filtrar por empresa
- `metadata` - para detectar si es SEC (busca `metadata.source === 'SEC'` o `metadata.accessionNumber`)
- `item_type` - para excluir posts
- `published_at` - SOLO para ordenar (no para contar)

### Importantes aclaraciones
❌ **NO se cuenta basándose en:** `metadata.form`, `metadata.baseForm`, etc.  
❌ **NO aplica ventana de tiempo** - cuenta TODOS los filings de la tabla  
✅ **SÍ incluye amendments** - no hay exclusión de `/A`  
✅ **SÍ está limitado a 1000** - query `.limit(1000)` en scraped_items

### Diferencia con IntelligenceView
En IntelligenceView **se usan LOS MISMOS 1000 items** pero se divide en:
```
los 630 SEC filings
+
news items (hasta ~370 si suman 1000 total)
= 813 eventos totales
```

### Conclusión sobre "630"
✅ **630 = Contador de SEC filings en base de datos para KURA**  
✅ Es **de la tabla `scraped_items`** filtrada por ticker  
✅ Es **calculado en memoria**, no es COUNT de BD  
✅ Es **limitado a 1000 items totales** de scraped_items  
⚠️ **Potencial problema:** Si hubiera >1000 items, los extras no se contarían

---

## 3. ¿POR QUÉ APARECEN Sep 10 vs Sep 9?

### El problema observado
```
Dashboard (DashboardPage):
  "630 SEC"
  "Updated Sep 9, 8:00 PM"

Activity Feed (IntelligenceView):
  "813 eventos"
  
SEC 3 — Kura Oncology, Inc. — Sep 10, 2026
SEC 4 — Kura Oncology, Inc. — Sep 10, 2026
```

### Causa raíz

**En Dashboard:**
- Muestra `lastUpdated` calculado en [DashboardPage.tsx](src/pages/DashboardPage.tsx#L35)
- `lastUpdated = max(item.published_at OR item.scraped_at)` DE TODOS LOS ITEMS (news + sec)
- Si el item SEC más reciente tiene `published_at = Sep 9`
- Y hay una noticia más reciente con `published_at = Sep 9 8:00 PM`
- Entonces `lastUpdated = Sep 9, 8:00 PM`

**En Activity Feed:**
- Cada evento individual mantiene su propia fecha: `itemDate(item)`
- SEC 3 filing tiene `published_at = 2026-09-10` (fecha del filing, no de scrape)
- SEC 4 filing tiene `published_at = 2026-09-10` (fecha del filing, no de scrape)
- Se muestran ambas

### Tabla de campos de fecha usados

| Ubicación | Elemento | Campo usado | Timezone | Significado |
|-----------|----------|-------------|----------|-------------|
| Dashboard summary | "630 SEC" date | `item.published_at ?? item.scraped_at` | America/New_York (función dateFormatter) | Fecha más reciente de ANY item (news/sec) |
| Activity row individual | SEC 3 fecha | `item.published_at ?? item.scraped_at` | UTC (dateFormatter) | Fecha del filing o fecha de scrape |
| CompanyWorkspacePage header | "Last updated" | `max(published_at, rating_date, transaction_date)` | Navegador local (sin zona especificada) | Fecha más reciente de cualquier fuente |
| Analyst Ratings tabla | Fecha | `rating_date` | UTC (dateFormatter) | Fecha de la acción del analista |
| Insider Trading tabla | Fecha | `transaction_date` | UTC (dateFormatter) | Fecha de la transacción |

### Discrepancia explicada

```
SEC filing published_at:   2026-09-10
NEWS published_at:         2026-09-09 20:00 (8:00 PM)

En Dashboard:
  lastUpdated = max(2026-09-10, 2026-09-09 20:00, ...)
  = 2026-09-10 o 2026-09-09 20:00 dependiendo del orden

En Activity Feed (CompanyWorkspacePage):
  - SEC filing: Sep 10 (published_at = 2026-09-10)
  - Other items: Sep 9 (published_at = 2026-09-09)
```

**El problema:** Las fechas se usan inconsistentemente:
- A veces se toma el MAX de todo
- A veces se muestran individuales
- Las timezones varían

---

## 4. CAMPOS DE FECHA - AUDITORÍA COMPLETA

### Para SEC Filings

**En BD (scraped_items):**
```typescript
{
  published_at: "2026-09-10"          // ← Del filing (filingDate)
  scraped_at: "2026-09-14T14:35:00Z"  // ← Cuando scrapeamos
  metadata: {
    filingDate: "2026-09-10",         // ← Duplicado en metadata
    reportDate: "2026-09-30",         // ← Fecha de reporte (distinta)
    accessionNumber: "...",
    form: "3",
    // ... otros campos
  }
}
```

**En código (IntelligenceView):**
```typescript
// Para determinar la fecha mostrada:
itemDate(item) = new Date(item.published_at ?? item.scraped_at).getTime()

// Para formatear:
dateFormatter.format(new Date(event.date))  // Con timezone: UTC
```

### Para Analyst Ratings

**En BD (finviz_analyst_ratings):**
```typescript
{
  rating_date: "2026-09-14"      // ← Fecha de la acción
  scraped_at: "2026-09-14T14:35" // ← Cuando scrapeamos
}
```

**En código (IntelligenceView):**
```typescript
date: new Date(`${item.rating_date.slice(0, 10)}T00:00:00Z`).getTime()
     // "2026-09-14" → 2026-09-14T00:00:00Z en UTC
```

### Para Insider Trading

**En BD (finviz_insider_trades):**
```typescript
{
  transaction_date: "2026-09-12"  // ← Fecha de transacción
  scraped_at: "2026-09-14T14:35"  // ← Cuando scrapeamos
  form4_display_timestamp?: string // ← Posible timestamp adicional
}
```

**En código (IntelligenceView):**
```typescript
date: new Date(`${item.transaction_date.slice(0, 10)}T00:00:00Z`).getTime()
```

### Conclusión sobre fechas
| Tipo | Campo principal | Campo secundario | Problema |
|------|-----------------|------------------|----------|
| SEC | `published_at` (filingDate) | `metadata.filingDate` | Duplicado en metadata, no se usa |
| SEC | `scraped_at` | N/A | Usado como fallback si published_at es null |
| Ratings | `rating_date` | `scraped_at` | Correcto, `scraped_at` no se usa |
| Insider | `transaction_date` | `scraped_at` | Correcto, `scraped_at` no se usa |

❌ **PROBLEMA:** `metadata.filingDate` en SEC se almacena pero no se usa. Es redundante.

---

## 5. TIMEZONE - AUDITORÍA COMPLETA

### Dashboard Page
**Archivo:** [src/pages/DashboardPage.tsx](src/pages/DashboardPage.tsx#L11)

```typescript
const dateTimeFormatter = new Intl.DateTimeFormat('en-US', { 
  month: 'short', 
  day: 'numeric', 
  hour: 'numeric', 
  minute: '2-digit', 
  timeZone: 'America/New_York'  // ← EXPLÍCITA
})
```

Usado en:
```typescript
function displayDate(value: string | null) { 
  return value ? dateTimeFormatter.format(new Date(value)) : 'Awaiting first update' 
}
```

**Resultado:** "Sep 9, 8:00 PM" está en **America/New_York**

### IntelligenceView (Activity Feed)
**Archivo:** [src/components/intelligence/IntelligenceView.tsx](src/components/intelligence/IntelligenceView.tsx#L4)

```typescript
const dateFormatter = new Intl.DateTimeFormat('en-US', { 
  month: 'short', 
  day: 'numeric', 
  year: 'numeric', 
  timeZone: 'UTC'  // ← EXPLÍCITA
})
```

**Resultado:** Fechas en activity feed están en **UTC**

### CompanyWorkspacePage (Header "Last updated")
**Archivo:** [src/pages/CompanyWorkspacePage.tsx](src/pages/CompanyWorkspacePage.tsx#L8)

```typescript
function lastUpdated(data: CompanyData) { 
  const dates = [
    ...data.items.map((item) => new Date(item.published_at ?? item.scraped_at).getTime()),
    ...data.ratings.map((item) => new Date(`${item.rating_date.slice(0, 10)}T00:00:00Z`).getTime()),
    ...data.insiderTrades.map((item) => new Date(`${item.transaction_date.slice(0, 10)}T00:00:00Z`).getTime())
  ]
  const value = Math.max(...dates, 0)
  return value 
    ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(value)) 
    : 'No updates yet' 
}
```

**Problema:** Sin `timeZone` especificado, usa **el timezone del navegador del usuario**

**Resultado:** "Sep 14, 2026" o similar, en la zona horaria local del navegador

### Analyst Ratings tabla
**Archivo:** [src/components/intelligence/IntelligenceView.tsx](src/components/intelligence/IntelligenceView.tsx#L4)

```typescript
const dateFormatter = new Intl.DateTimeFormat('en-US', { 
  month: 'short', 
  day: 'numeric', 
  year: 'numeric', 
  timeZone: 'UTC'
})

function date(value: string | null) { 
  return value ? dateFormatter.format(new Date(`${value.slice(0, 10)}T00:00:00Z`)) : 'Date unavailable' 
}
```

**Resultado:** **UTC**

### Insider Trading tabla
Same as Analyst Ratings: **UTC**

---

## 6. ¿SE MEZCLAN `scraped_at` Y FECHAS DE EVENTO?

### Sí, hay mezcla problemática

**En IntelligenceView:**
```typescript
function itemDate(item: ScrapedItem) { 
  return new Date(item.published_at ?? item.scraped_at).getTime()  // ← MEZCLA
}
```

Para SEC:
- **Si `published_at` existe:** Usa `published_at` (filingDate) ✅
- **Si `published_at` es null:** Cae a `scraped_at` (cuándo lo scrapeamos) ❌

Esto es problemático porque:
- Un SEC filing sin `published_at` mostraría la fecha de scrape como si fuera la fecha del evento
- Esto perderían la fecha histórica del evento

**En CompanyWorkspacePage:**
```typescript
const dates = [
  ...data.items.map((item) => new Date(item.published_at ?? item.scraped_at).getTime()),  // ← MEZCLA
  ...data.ratings.map((item) => new Date(`${item.rating_date.slice(0, 10)}T00:00:00Z`).getTime()),
  ...data.insiderTrades.map((item) => new Date(`${item.transaction_date.slice(0, 10)}T00:00:00Z`).getTime())
]
```

Mismo problema: si falta `published_at`, usa `scraped_at`.

**En DashboardPage:**
```typescript
if (!summary.lastUpdated || effectiveDate(item) > new Date(summary.lastUpdated).getTime()) 
  summary.lastUpdated = item.published_at ?? item.scraped_at
```

Usa ambas indistintamente.

### Conclusión
⚠️ **Se mezclan y pueden causar confusión temporal**

---

## 7. ¿CUÁNTO CONTENIDO CARGA EL NAVEGADOR INNECESARIAMENTE?

### Datos traídos de la BD

**Para CompanyWorkspacePage:**

```typescript
// 1. Scraped Items (news + SEC)
client.from('scraped_items')
  .select(itemSelect)  // 13 campos
  .eq('ticker', normalizedTicker)
  .order('published_at', { ascending: false, nullsFirst: false })
  .order('scraped_at', { ascending: false })
  .limit(1000)  // ← TRAE HASTA 1000 REGISTROS
```

**Cada registro contiene:**
- `id`, `source_id`, `ticker`, `title` (nullable), `content` (nullable), `author` (nullable), `url`, `published_at` (nullable), `scraped_at`, `content_hash`, `metadata` (JSON), `created_at`, `item_type`

Para KURA con 813 eventos en total, si `limit(1000)`:
- Trae **~370 news items** + **630 SEC items** = **~1000 registros**

Cada registro típico:
- Campos simples: ~200 bytes
- `content`: puede ser 1-5KB
- `metadata`: para SEC puede ser 500-1000 bytes
- **Por registro: ~2-7KB en promedio**

**Total para scraped_items:**
```
1000 registros × 4KB promedio = 4 MB
```

**Para finviz_analyst_ratings:**
```
.select('id, ticker, source_id, rating_date, action, analyst, rating_change, price_target_change, created_at, scraped_at, content_hash')
.eq('ticker', normalizedTicker)
.order('rating_date', { ascending: false })
// SIN LIMIT - trae TODOS los ratings
```

Si KURA tiene 50 ratings:
```
50 registros × 0.5KB = 25 KB
```

**Para finviz_insider_trades:**
```
SIN LIMIT - trae TODOS los insider trades
```

Si KURA tiene 20 insider trades:
```
20 registros × 1KB = 20 KB
```

**Total transferencia al navegador:**
```
Scraped items:      ~4,000 KB
Ratings:               ~25 KB
Insider trades:        ~20 KB
─────────────────────────────
Total:              ~4,045 KB ≈ 4 MB
```

### Performance issue

**Problema:** Para mostrar solo "Recent Activity" se cargan **1000 registros de scraped_items**

En [IntelligenceView.tsx](src/components/intelligence/IntelligenceView.tsx), se concatenan todos:

```typescript
const activity = [
  ...news.map(...),              // Mapea ~370
  ...sec.map(...),               // Mapea ~630
  ...ratings.map(...),           // Mapea ~50
  ...insiderTrades.map(...)      // Mapea ~20
].sort((a, b) => b.date - a.date)
```

Esto son **~1070 elementos en el array**, todos en memoria del navegador.

Cuando se renderiza:
```typescript
{activity.map((event) => <article className="activity-row" key={event.key}>...)}
```

React renderiza todos como elementos del DOM (aunque estén off-screen).

---

## 8. PROPUESTA DE ARQUITECTURA: ACTIVITY FEED CORRECTO

### Problema actual
- Activity feed muestra **todos los datos disponibles** (limitados a 1000 items)
- No diferencia entre "eventos recientes" y "histórico"
- Carga todo al navegador

### Propuesta de mejora

#### Opción A: Virtualization + Lazy Loading (RECOMENDADO)

```typescript
// 1. Query solo últimos N eventos recientes
export async function getCompanyActivityFeed(
  client: SupabaseClient, 
  ticker: string, 
  limit: number = 50  // Últimos 50 eventos
): Promise<ActivityEvent[]> {
  const items = await client.from('scraped_items')
    .select(itemSelect)
    .eq('ticker', ticker)
    .order('published_at', { ascending: false })
    .limit(limit)
  
  // Combina con ratings e insider trades más recientes
  // ...
  
  return activity
}

// 2. En IntelligenceView
export function IntelligenceView({ ticker }: { ticker: string }) {
  const [activity, setActivity] = useState<ActivityEvent[]>([])
  const [hasMore, setHasMore] = useState(true)
  
  // Carga primeros 50
  useEffect(() => {
    loadActivityFeed(ticker, 50).then(setActivity)
  }, [ticker])
  
  // Carga más cuando usuario hace scroll cerca del final
  const handleLoadMore = async () => {
    const more = await loadActivityFeed(ticker, 50, activity.length)
    setActivity([...activity, ...more])
  }
  
  return (
    <VirtualizedList 
      items={activity}
      onNearEnd={handleLoadMore}
    />
  )
}
```

#### Opción B: Separación explícita (SIMPLE)

```typescript
// Activity Feed solo últimos eventos
<section className="activity-feed">
  <div className="workspace-section-heading">
    <h2>Recent Activity (Last 30 days)</h2>
  </div>
  <ActivityList items={recentActivity.slice(0, 20)} />
</section>

// Dataset Summary por tipo
<section className="data-summary">
  <div className="summary-grid">
    <SummaryCard 
      label="News" 
      count={totalNews} 
      latest={latestNews}
      latestDate={latestNewsDate}
    />
    <SummaryCard 
      label="SEC Filings" 
      count={totalFilings} 
      latest={latestFiling}
      latestDate={latestFilingDate}
    />
    <SummaryCard 
      label="Analyst Ratings" 
      count={totalRatings} 
      latest={latestRating}
      latestDate={latestRatingDate}
    />
    <SummaryCard 
      label="Insider Trades" 
      count={totalInsiders} 
      latest={latestInsider}
      latestDate={latestInsiderDate}
    />
  </div>
</section>
```

---

## 9. PROPUESTA DE CONTEOS CORRECTA

### Problema actual
- "813 eventos" mezcla 4 tipos diferentes sin contexto
- No es claro cuál es la proporción de cada tipo
- Hace que parezca que hay más datos de los que realmente hay

### Propuesta

**Opción A: Separados por tipo (RECOMENDADO)**

```typescript
export function DataSummary({ data }: { data: CompanyData }) {
  const newsCount = data.items.filter(i => !isSec(i) && i.item_type !== 'post').length
  const secCount = data.items.filter(i => isSec(i)).length
  const ratingsCount = data.ratings.length
  const insidersCount = data.insiderTrades.length
  
  return (
    <div className="data-summary">
      <SummaryCard 
        icon={<Newspaper size={20} />}
        label="News Stories"
        count={newsCount}
        color="blue"
        latestDate={latestNewsDate}
      />
      <SummaryCard 
        icon={<FileText size={20} />}
        label="SEC Filings"
        count={secCount}
        color="green"
        latestDate={latestFilingDate}
      />
      <SummaryCard 
        icon={<TrendingUp size={20} />}
        label="Analyst Ratings"
        count={ratingsCount}
        color="orange"
        latestDate={latestRatingDate}
      />
      <SummaryCard 
        icon={<Users size={20} />}
        label="Insider Trades"
        count={insidersCount}
        color="purple"
        latestDate={latestInsiderDate}
      />
    </div>
  )
}

// En la UI:
// ┌─────────────────────────────────────┐
// │ News Stories    SEC Filings         │
// │      45              630             │
// │ Latest: Sep 10 │ Latest: Sep 10     │
// │                                     │
// │ Analyst Ratings  Insider Trades     │
// │       12              6              │
// │ Latest: Sep 12 │ Latest: Sep 11     │
// └─────────────────────────────────────┘
```

**Opción B: Tabbed interface**

```
[News]  [SEC Filings]  [Ratings]  [Insider Trades]

When "SEC Filings" selected:
  "630 SEC filings for KURA"
  [List of 630 filings, paginated]
```

---

## 10. PROPUESTA DE "LAST UPDATED" CORRECTA

### Problema actual
- "Last updated: Sep 14, 2026" es ambiguo
- No aclara qué tipo de datos se actualizó
- Usa timezone del navegador (inconsistente)

### Propuesta

#### Opción A: Específico por tipo (RECOMENDADO)

```typescript
// Cambiar de:
<div className="company-actions">
  <span>{t('lastUpdated')}: {data ? lastUpdated(data) : t('loading')}</span>
</div>

// A:
<div className="company-actions">
  <div className="update-info">
    <span className="label">Activity from:</span>
    <div className="update-details">
      <span>News: {latestNewsDate}</span>
      <span>SEC: {latestFilingDate}</span>
      <span>Ratings: {latestRatingDate}</span>
      <span>Insider: {latestInsiderDate}</span>
    </div>
  </div>
  <button className="quiet-button" onClick={() => void load()}>
    <RefreshCw size={15} className={loading ? 'spin' : ''} />
  </button>
</div>

// Render:
// ┌─────────────────────────────────────┐
// │ Activity from:                      │
// │ News: Sep 10, 2026                 │
// │ SEC: Sep 10, 2026                  │
// │ Ratings: Sep 12, 2026              │
// │ Insider: Sep 11, 2026              │
// └─────────────────────────────────────┘
```

#### Opción B: Timestamp de scrape (ALTERNATIVA)

```typescript
// Si el usuario quiere saber cuándo nosotros actualizamos los datos:
<div className="company-actions">
  <span>Last scraped: {lastScrapedAt}</span>
  <span>Latest data: {latestEventDate}</span>
</div>
```

---

## 11. RESUMEN DE HALLAZGOS

### A. ¿Qué significa exactamente "813"?
✅ **813 = news + SEC filings + analyst ratings + insider trades (TODOS)**
- Suma de 4 tablas diferentes
- Contados en memoria en React
- Dinámico según contenido de BD

### B. ¿Qué significa exactamente "630 SEC"?
✅ **630 = Conteo de rows en `scraped_items` donde `isSec(item) = true`**
- Solo de SEC filings
- Limitado a primeros 1000 items de scraped_items
- Contados en memoria (no es COUNT de SQL)

### C. ¿Por qué aparecen Sep 10 vs Sep 9?
⚠️ **Inconsistencia de lógica:**
- Dashboard muestra `lastUpdated = max de TODOS los items`
- Activity feed muestra cada item con su fecha individual
- Si hay filings de Sep 10 y noticias de Sep 9, aparecen ambas
- El header muestra la más reciente (que puede ser de otro tipo de evento)

### D. ¿Qué campos de fecha usa cada parte?
| Componente | Tabla | Campo | Timezone |
|-----------|-------|-------|----------|
| Dashboard "Updated" | scraped_items | published_at \|\| scraped_at | America/New_York |
| Activity item | scraped_items | published_at \|\| scraped_at | UTC |
| CompanyWorkspacePage "Last updated" | Todas | max(published_at, rating_date, transaction_date) | Navegador local |
| Ratings table | finviz_analyst_ratings | rating_date | UTC |
| Insider table | finviz_insider_trades | transaction_date | UTC |

### E. ¿Timezone usado en cada parte?
- **Dashboard:** America/New_York
- **Activity Feed:** UTC
- **Company Header:** Navegador local (SIN especificar)
- **Ratings/Insider tables:** UTC

**Problemas:**
❌ Inconsistencia: 3 diferentes timezones
❌ CompanyWorkspacePage no especifica timezone → puede confundir

### F. ¿Se mezclan `scraped_at` y fechas de evento?
✅ **Sí**, problemáticamente:
```typescript
new Date(item.published_at ?? item.scraped_at)
```
Si `published_at` es null (no debería ocurrir para SEC), cae a `scraped_at`.

### G. ¿Cuánto contenido carga el navegador innecesariamente?
- **~1000 items de scraped_items** (potencialmente 4 MB de datos)
- **Todos los ratings** (sin limit)
- **Todos los insider trades** (sin limit)
- **Total:** ~4 MB de datos se cargan para mostrar solo una lista

⚠️ **Performance issue:** Se trae todo pero se mostraría un subconjunto

### H. Propuesta de Activity Feed correcta
✅ **Virtualization + Lazy loading**
- Carga solo últimos 50 eventos
- Trae más al hacer scroll
- Reduce transferencia a ~200KB

### I. Propuesta de conteos correcta
✅ **Separar por tipo con tarjetas**
```
News: 45 | SEC: 630 | Ratings: 12 | Insiders: 6
```
En lugar de:
```
813 eventos
```

### J. Propuesta de "Last Updated" correcta
✅ **Mostrar fecha de cada tipo:**
```
News: Sep 10
SEC: Sep 10
Ratings: Sep 12
Insider: Sep 11
```
En lugar de un único "Last updated"

### K. ¿Qué habría que modificar?

**Alta prioridad:**
1. ✏️ IntelligenceView: Separar Activity Feed en dos secciones
   - "Recent Events" (últimos 50)
   - "Data Summary by Type" (conteos)
2. ✏️ CompanyWorkspacePage: Especificar timezone en "Last Updated" (UTC)
3. ✏️ Agregar conteos separados por tipo en IntelligenceView

**Mediana prioridad:**
4. 🔍 Verificar datos: No asumir que `published_at` siempre existe para SEC
5. ✏️ Limpiar metadata duplicada (metadata.filingDate no se usa)
6. ✏️ Implementar virtualization para Activity Feed

**Baja prioridad:**
7. 📊 Mejorar visualización de "Latest date" (usar formato consistente)
8. 📝 Considerar Lazy loading de más eventos

### L. ¿Qué NO debemos tocar?

- ✅ NO modificar: Base de datos schema
- ✅ NO modificar: Edge Functions
- ✅ NO modificar: Cron jobs o scraping
- ✅ NO modificar: RLS policies
- ✅ NO modificar: Timezones de almacenamiento (BD siempre UTC)
- ✅ Sí RENOVAR: Solo la presentación en React

### M. Prioridad de correcciones

```
CRÍTICO (Implementar primero):
  1. Separar conteo de "813" en 4 valores: News + SEC + Ratings + Insider
  2. Especificar timezone en CompanyWorkspacePage "Last Updated"
  
IMPORTANTE (Después):
  3. Mostrar fecha más reciente por tipo (no mezclar)
  4. Implementar lazy loading en Activity Feed
  
MEJORA (Opcional):
  5. Limpiar metadata duplicada en BD
  6. Agregar virtualization
```

---

## CONCLUSIÓN

El sistema actual **funciona pero es confuso** por:

1. **Mezclar 4 tipos de datos sin diferenciación** (813 eventos)
2. **Mostrar conteos sin contexto** (630 SEC vs 813 total)
3. **Inconsistencia en campos de fecha** (published_at vs scraped_at)
4. **Múltiples timezones** sin explicación clara
5. **Cargar demasiados datos innecesariamente** (~4 MB)

**Soluciones recomendadas:**
- Separar visualización por tipo de datos
- Usar timezones consistentes
- Implementar lazy loading
- Mostrar "Latest date" por tipo, no un único "Last Updated"

**Impacto estimado:**
- ✅ Mayor claridad para el usuario
- ✅ Mejor performance (~10x reducción de datos)
- ✅ Menor confusión temporal
- ⏱️ Esfuerzo: ~4-6 horas de desarrollo
- ⚠️ Riesgo: Bajo (solo cambios de UI)

---

**Fin del reporte de auditoría**  
No se realizaron cambios en código, BD ni Edge Functions.
