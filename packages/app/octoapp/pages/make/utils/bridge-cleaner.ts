/**
 * Clean bridge scripts/styles/attributes injected by srcdoc builder
 * Ensures saved HTML files don't contain runtime-only bridge content
 * 
 * Preserves:
 * - deck-bridge (slide navigation functionality for deck artifacts)
 */

export function cleanBridgeContent(html: string): string {
  return html
    // 1. Remove all bridge script tags except deck-bridge
    .replace(/<script\s+data-od-(?!deck-bridge)[a-z-]+[^>]*>[\s\S]*?<\/script>/gi, '')
    
    // 2. Remove all bridge style tags (including content)
    .replace(/<style\s+data-od-[a-z-]+[^>]*>[\s\S]*?<\/style>/gi, '')
    
    // 3. Remove all data-od-* attributes from elements
    .replace(/\s+data-od-[a-z-]+(?:="[^"]*")?/gi, '')
    
    // 4. Clean empty script/style tags that might remain
    .replace(/<script><\/script>/gi, '')
    .replace(/<style><\/style>/gi, '')
}