import { resolve } from "node:path";

const fx = (f: string) => resolve(import.meta.dirname, "fixtures", f);

export interface EvalCase {
  id: string;
  prompt: string;
  /** Optional follow-up edit run on the built dashboard. */
  edit?: string;
  /** A question asked after the build (about a picked card): must be answered without changing the page. */
  ask?: string;
  /** Plain-language must-haves the judge checks against the screenshot. */
  expect: string[];
  /** Exact values computed from the fixtures; the rendered page must show each (within tolerance). */
  truth?: { label: string; sql: string; percent?: boolean }[];
  /** The request can't be fulfilled; passing means no dashboard with made-up numbers. */
  mustNotFabricate?: boolean;
  /** The build should ask the user questions first (broad/vague requests). */
  expectQuestions?: boolean;
  /** How the simulated user answers questions: the first option matching this wins, else the first option. */
  prefer?: RegExp;
  /** Minimum number of pages expected. */
  minPages?: number;
  /** The edit should be surgical: share of the original HTML lines that must survive. */
  minPreserved?: number;
  suite?: "core" | "hard" | "loop";
}

const ORD = `read_csv_auto('${fx("orders.csv")}')`;
const EXP = `read_csv_auto('${fx("expenses_messy.csv")}', all_varchar=true)`;

export const CASES: EvalCase[] = [
  {
    id: "orders-csv",
    prompt: `Sales dashboard from my orders file ${fx("orders.csv")}: revenue by month, compare the last 30 days to the 30 before, revenue by region and by product, and the top 10 customers.`,
    edit: "Make the monthly revenue chart a line with an area fill and add a KPI for average order value.",
    expect: ["KPIs with a comparison to the prior 30 days", "a monthly revenue trend", "revenue by region", "revenue by product", "a top-10 customers table or list"],
  },
  {
    id: "support-sqlite",
    prompt: `Support team dashboard from ${fx("support.sqlite")} (table tickets): open vs closed tickets, median time to close by priority, tickets per week by channel, CSAT by agent, and the busiest topics.`,
    expect: ["open vs closed counts", "time to close by priority", "weekly tickets by channel", "CSAT by agent", "topics ranking"],
  },
  {
    id: "earthquakes",
    prompt: "Earthquake monitor from the USGS feed https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson : count per day, magnitude bands, the 8 strongest with place and time, and headline KPIs comparing the last 3 days to the 3 before.",
    expect: ["daily count trend", "magnitude distribution", "strongest quakes list with places", "KPIs with a comparison"],
  },
  {
    id: "weather",
    prompt: "7-day weather outlook for New York City from https://api.open-meteo.com/v1/forecast?latitude=40.71&longitude=-74.01&hourly=temperature_2m,precipitation_probability,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=America%2FNew_York&temperature_unit=fahrenheit : daily highs and lows, hourly temperature, rain chances, and the windiest day.",
    expect: ["daily high/low", "hourly temperature line", "precipitation chance", "windiest day called out"],
  },
  {
    id: "github",
    prompt: "Open-source health dashboard for the vercel/next.js repo using the public GitHub API (https://api.github.com/repos/vercel/next.js and https://api.github.com/repos/vercel/next.js/issues?state=all&per_page=100): stars, forks, open issues, issues opened vs closed recently, and the most active labels.",
    expect: ["stars/forks/open issues KPIs", "issues opened vs closed", "labels ranking"],
  },
  {
    id: "world-bank",
    prompt: "Economy snapshot: GDP of the 10 largest economies from the World Bank API (https://api.worldbank.org/v2/country/USA;CHN;JPN;DEU;IND;GBR;FRA;ITA;BRA;CAN/indicator/NY.GDP.MKTP.CD?format=json&date=2014:2024&per_page=200): latest GDP ranking, GDP over the last decade, and growth over the period.",
    expect: ["latest GDP ranking", "GDP trend over ~10 years", "growth comparison"],
  },
  {
    id: "orders-exact",
    suite: "hard",
    prompt: `From my orders file ${fx("orders.csv")}: total revenue for Q3 2026 (July 1 to September 30), Q3 revenue by region, and the share of Q3 revenue that came from the Enterprise product.`,
    expect: ["Q3 2026 total revenue", "Q3 revenue by region", "Enterprise share of Q3 revenue"],
    truth: [
      { label: "Q3 total revenue", sql: `SELECT sum(revenue) FROM ${ORD} WHERE order_date BETWEEN '2026-07-01' AND '2026-09-30'` },
      { label: "Q3 Europe revenue", sql: `SELECT sum(revenue) FROM ${ORD} WHERE order_date BETWEEN '2026-07-01' AND '2026-09-30' AND region='Europe'` },
      { label: "Enterprise share of Q3", percent: true, sql: `SELECT sum(revenue) FILTER (WHERE product='Enterprise') / sum(revenue) FROM ${ORD} WHERE order_date BETWEEN '2026-07-01' AND '2026-09-30'` },
    ],
  },
  {
    id: "expenses-messy",
    suite: "hard",
    prompt: `Expense dashboard from ${fx("expenses_messy.csv")}: total spend, spend by month, by category and by employee, and the 10 largest expenses.`,
    expect: ["total spend", "spend by month", "spend by category", "spend by employee", "largest expenses list"],
    // Ground truth sums every recorded amount, so a user asked about refunds or duplicates keeps them as recorded.
    prefer: /as recorded|keep|include|all (entries|rows)/i,
    truth: [{ label: "Total spend", sql: `SELECT sum(CAST(replace(replace(Amount,'$',''),',','') AS DOUBLE)) FROM ${EXP} WHERE Amount IS NOT NULL AND Amount <> ''` }],
  },
  {
    id: "targets-join",
    suite: "hard",
    prompt: `Compare revenue to target by region for January through September 2026. Revenue is in ${fx("orders.csv")} and monthly targets are in ${fx("targets.json")}. Show attainment % by region, monthly revenue vs target for the whole company, and which region is furthest behind.`,
    expect: ["attainment % by region", "monthly revenue vs target", "region furthest behind called out"],
    truth: [
      {
        label: "North America attainment Jan-Sep",
        percent: true,
        sql: `SELECT (SELECT sum(revenue) FROM ${ORD} WHERE region='North America' AND order_date BETWEEN '2026-01-01' AND '2026-09-30') / (SELECT sum(v) FROM (SELECT unnest(map_values(CAST(json_extract(j, '$.monthly_revenue_targets."North America"') AS MAP(VARCHAR, DOUBLE)))) v FROM (SELECT CAST(content AS JSON) j FROM read_text('${fx("targets.json")}'))))`,
      },
    ],
  },
  {
    id: "heavy-edit",
    suite: "hard",
    prompt: "7-day weather outlook for Chicago from https://api.open-meteo.com/v1/forecast?latitude=41.88&longitude=-87.63&hourly=temperature_2m,precipitation_probability,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=America%2FChicago&temperature_unit=fahrenheit : daily highs and lows, hourly temperature, rain chances and wind.",
    edit: "Replace the hourly temperature line with a heatmap of temperature by day and hour, remove everything about wind, and add a short callout naming the best day to be outside and why.",
    expect: ["temperature heatmap by day and hour", "no wind content anywhere", "best-day-to-be-outside callout", "daily highs and lows still present"],
  },
  {
    id: "no-access",
    suite: "hard",
    prompt: "Dashboard of my Shopify store's sales this month: revenue, orders, top products.",
    expect: ["honest message that Shopify data isn't available"],
    mustNotFabricate: true,
  },
  {
    id: "tiny-edit",
    suite: "loop",
    prompt: `Support dashboard from ${fx("support.sqlite")} (table tickets): ticket volume by week, time to close by priority, CSAT by agent.`,
    edit: "Rename the CSAT chart to \"Customer happiness by agent\".",
    minPreserved: 0.97,
    expect: ["weekly volume", "time to close by priority", "CSAT chart titled Customer happiness by agent"],
  },
  {
    id: "ask-card",
    suite: "loop",
    prompt: `Support dashboard from ${fx("support.sqlite")} (table tickets): ticket volume by week, time to close by priority, CSAT by agent.`,
    ask: "what is this",
    expect: ["weekly volume", "time to close by priority", "CSAT by agent"],
  },
  {
    id: "workbook",
    suite: "loop",
    prompt: `Build me a complete sales workbook from ${fx("orders.csv")} with separate pages: an overview, customers (top customers, new vs returning, concentration), products (mix, growth, units), and regions (performance and trends).`,
    edit: "On the customers page only, add a table of customers whose spending dropped the most in the last 60 days versus the 60 before.",
    minPages: 4,
    minPreserved: 0.85,
    expect: ["4+ pages with tabs", "overview KPIs", "customers page details", "products page", "regions page"],
  },
  {
    id: "vague",
    suite: "loop",
    prompt: `Make me a dashboard from ${fx("orders.csv")}.`,
    expectQuestions: true,
    expect: ["sensible sales KPIs", "a trend", "useful breakdowns"],
  },
];
