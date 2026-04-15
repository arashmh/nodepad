import { NextRequest, NextResponse } from "next/server"

type UrlMeta = {
  title: string
  description: string
  excerpt: string
  sections: { heading: string; text: string }[]
  statusCode: number
}

// ── Section extraction for academic pages ─────────────────────────────────────

const SECTION_KEYWORDS = [
  "abstract",
  "summary",
  "introduction",
  "background",
  "problem",
  "motivation",
  "methods",
  "methodology",
  "approach",
  "results",
  "findings",
  "discussion",
  "conclusion",
  "implications",
]

function extractSections(html: string): { heading: string; text: string }[] {
  // Strip scripts, styles, nav, footer, header, aside
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<aside[\s\S]*?<\/aside>/gi, "")

  const sections: { heading: string; text: string }[] = []

  // Strategy 1: Look for heading tags (h1-h4) whose text matches academic keywords
  const headingRegex = /<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi
  let match: RegExpExecArray | null
  const headingPositions: { heading: string; index: number }[] = []

  while ((match = headingRegex.exec(stripped)) !== null) {
    const headingText = match[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().toLowerCase()
    const keyword = SECTION_KEYWORDS.find(k => headingText.includes(k))
    if (keyword) {
      headingPositions.push({ heading: keyword, index: match.index + match[0].length })
    }
  }

  // Extract text between matched headings (up to next heading or 3000 chars)
  for (let i = 0; i < headingPositions.length; i++) {
    const start = headingPositions[i].index
    const end = i + 1 < headingPositions.length
      ? headingPositions[i + 1].index - 100  // rough offset for the heading tag itself
      : start + 4000
    const sectionHtml = stripped.slice(start, Math.min(end, start + 4000))
    const text = sectionHtml
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 2000)
    if (text.length > 80) {
      sections.push({ heading: headingPositions[i].heading, text })
    }
  }

  // Strategy 2: If no headings matched, try <section> or <div> with id/class containing keywords
  if (sections.length === 0) {
    for (const keyword of SECTION_KEYWORDS) {
      const attrRegex = new RegExp(
        `<(?:section|div)[^>]*(?:id|class)="[^"]*${keyword}[^"]*"[^>]*>([\\s\\S]*?)(?=<(?:section|div)[^>]*(?:id|class)=|$)`,
        "i"
      )
      const m = stripped.match(attrRegex)
      if (m) {
        const text = m[1]
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 2000)
        if (text.length > 80) {
          sections.push({ heading: keyword, text })
        }
      }
    }
  }

  // Strategy 3: Look for "Abstract" etc. as bold/strong text starting a paragraph
  if (sections.length === 0) {
    for (const keyword of ["abstract", "summary", "results", "conclusion"]) {
      const boldRegex = new RegExp(
        `<(?:strong|b|em)[^>]*>\\s*${keyword}[:\\.]?\\s*<\\/(?:strong|b|em)>([\\s\\S]{80,2000}?)(?=<(?:h[1-4]|strong|b)[^>]*>|$)`,
        "i"
      )
      const m = stripped.match(boldRegex)
      if (m) {
        const text = m[1]
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 2000)
        if (text.length > 80) {
          sections.push({ heading: keyword, text })
        }
      }
    }
  }

  return sections.slice(0, 6) // cap at 6 sections
}

function extractMeta(html: string): Omit<UrlMeta, "statusCode"> {
  const tag = (pattern: RegExp) => {
    const m = html.match(pattern)
    return m ? m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").trim() : ""
  }

  const title =
    tag(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i) ||
    tag(/<meta[^>]+content="([^"]+)"[^>]+property="og:title"/i) ||
    tag(/<title[^>]*>([^<]{1,200})<\/title>/i)

  const description =
    tag(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i) ||
    tag(/<meta[^>]+content="([^"]+)"[^>]+property="og:description"/i) ||
    tag(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i) ||
    tag(/<meta[^>]+content="([^"]+)"[^>]+name="description"/i)

  const excerpt = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1500)

  const sections = extractSections(html)

  return { title: title.slice(0, 200), description: description.slice(0, 400), excerpt, sections }
}

async function fetchUrlMeta(url: string): Promise<UrlMeta | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 6000)
    let res: Response
    try {
      res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "nodepad/1.0 (+https://nodepad.space)",
          "Accept": "text/html,application/xhtml+xml",
        },
        redirect: "follow",
      })
    } finally {
      clearTimeout(timer)
    }

    const statusCode = res.status
    if (!res.ok) return { title: "", description: "", excerpt: "", statusCode }

    const ct = res.headers.get("content-type") || ""
    if (!ct.includes("text/html")) {
      const kind = ct.split(";")[0].trim()
      return { title: "", description: `Non-HTML resource: ${kind}`, excerpt: "", statusCode }
    }

    const html = await res.text()
    return { ...extractMeta(html), statusCode }
  } catch {
    return null
  }
}

// ── SSRF protection ───────────────────────────────────────────────────────────
// Blocks requests to private/reserved IP ranges and special hostnames so this
// endpoint cannot be used to probe internal networks or cloud metadata services.

function isBlockedHost(rawUrl: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return true // unparseable → block
  }

  // Only http/https — no file://, ftp://, etc.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return true

  const h = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "") // strip IPv6 brackets

  // Named loopback / metadata hostnames
  if (h === "localhost") return true
  if (h === "metadata.google.internal") return true

  // IPv6 loopback and link-local
  if (h === "::1" || h === "0:0:0:0:0:0:0:1") return true
  if (h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true

  // IPv4 private / reserved ranges
  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])]
    if (a === 0)                              return true // 0.0.0.0/8
    if (a === 10)                             return true // 10.0.0.0/8
    if (a === 127)                            return true // 127.0.0.0/8 loopback
    if (a === 169 && b === 254)               return true // 169.254.0.0/16 link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31)      return true // 172.16.0.0/12
    if (a === 192 && b === 168)               return true // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127)     return true // 100.64.0.0/10 shared space
    if (a === 198 && (b === 18 || b === 19))  return true // 198.18.0.0/15 benchmarking
    if (a === 203 && b === 0 && Number(ipv4[3]) === 113) return true // 203.0.113.0/24 documentation
    if (a >= 224)                             return true // multicast + reserved (224–255)
  }

  return false
}

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json()
    const urlStr = String(url ?? "")

    if (!urlStr || !/^https?:\/\//i.test(urlStr)) {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 })
    }
    if (isBlockedHost(urlStr)) {
      return NextResponse.json({ error: "Blocked URL" }, { status: 400 })
    }

    const meta = await fetchUrlMeta(urlStr)
    return NextResponse.json(meta)
  } catch {
    return NextResponse.json(null)
  }
}
