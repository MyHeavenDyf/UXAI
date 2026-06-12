import type { Config } from 'tailwindcss'

export default {
  content: [
    './index.html',
    './src/**/*.{vue,js,ts,jsx,tsx}',
    './src/jsonStorage/*.json',
    '../test-project/test/**/*.json'
  ],
  theme: {
    "extend": {
      "colors": {
        "primary": "var(--primary, #0067D1)",
        "on-primary": "var(--on-primary, #FFFFFF)",
        "primary-container": "var(--primary-container, #E6F2FD)",
        "on-primary-container": "var(--on-primary-container, #191919)",
        "primary-fixed": "var(--primary-fixed, #0067D1)",
        "primary-fixed-dim": "var(--primary-fixed-dim, #004EA8)",
        "on-primary-fixed": "var(--on-primary-fixed, #FFFFFF)",
        "on-primary-fixed-variant": "var(--on-primary-fixed-variant, #F3F3F3)", 
        
        "surface": "var(--surface, #F3F3F3)",
        "surface-dim": "var(--surface-dim, #DFDFDF)",
        "surface-bright": "var(--surface-bright, #FFFFFF)",
        "on-surface": "var(--on-surface, #191919)",
        "surface-variant": "var(--surface-variant, rgba(192,192,192,0.2))",
        "on-surface-variant": "var(--on-surface-variant, #777777)",
        "surface-container-lowest": "var(--surface-container-lowest, #F3F3F3)",
        "surface-container-low": "var(--surface-container-low, rgba(255,255,255,0.5))",
        "surface-container": "var(--surface-container, rgba(255,255,255,0.65))",
        "surface-container-high": "var(--surface-container-high, rgba(255,255,255,0.8))",
        "surface-container-highest": "var(--surface-container-highest, #FFFFFF)",
        
        "inverse-surface": "var(--inverse-surface, #191919)",
        "inverse-on-surface": "var(--inverse-on-surface, #FFFFFF)",
        "inverse-on-surface-variant": "var(--inverse-on-surface-variant, #C9C9C9)",
        "inverse-primary": "var(--inverse-primary, #0067D1)",

        "error": "var(--error, #E02128)",
        "on-error": "var(--on-error, #FFFFFF)",
        "error-container": "var(--error-container, #FEE7E8)",
        "on-error-container": "var(--on-error-container, #191919)",
        
        "success": "var(--success, #09AA71)",
        "on-success": "var(--on-success, #FFFFFF)",
        "success-container": "var(--success-container, #E7FBF2)",
        "on-success-container": "var(--on-success-container, #191919)",

        "critical": "var(--critical, #F4840C)",
        "on-critical": "var(--on-critical, #FFFFFF)",
        "critical-container": "var(--critical-container, #FEF5E8)",
        "on-critical-container": "var(--on-critical-container, #191919)",

        "warning": "var(--warning, #FCC800)",
        "on-warning": "var(--on-warning, #FFFFFF)",
        "warning-container": "var(--warning-container, #FEFCE0)",
        "on-warning-container": "var(--on-warning-container, #191919)",

        "info": "var(--info, #0067D1)",
        "on-info": "var(--on-info, #FFFFFF)",
        "info-container": "var(--info-container, #E6F2FD)",
        "on-info-container": "var(--on-info-container, #191919)",

        "divider": "var(--divider, #F3F3F3)"
      },
      "spacing": {
        'inline': '0.5rem',
        'stack': '0.75rem',
        'gutter': '1rem', 
        'inset': '1.5rem',
        'section': '1rem', 
        'page': '2rem'    
      },
      "boxShadow": {
        'sm': 'var(--shadow-sm, 1px 1px 6px 0 rgba(0, 0, 0, 0.08))',
        'md': 'var(--shadow-md, 0 4px 12px 0px rgba(0, 0, 0, 0.16))',
        'lg': 'var(--shadow-lg, 0 8px 24px 0px rgba(0, 0, 0, 0.16))',
        'xl': 'var(--shadow-xl, 0 16px 48px 0px rgba(0, 0, 0, 0.16))',
        'card': 'var(--shadow-sm, 1px 1px 6px 0 rgba(0, 0, 0, 0.08))',
        'popover': 'var(--shadow-lg, 0 8px 24px 0px rgba(0, 0, 0, 0.16))',
        'modal': 'var(--shadow-xl, 0 16px 48px 0px rgba(0, 0, 0, 0.16))'
      },
      "borderColor": {
        'base': 'var(--border, #C9C9C9)',
        'divider': 'var(--divider, #F3F3F3)',
        'selected': 'var(--primary-500, #0067D1)',
        'error': 'var(--error-500, #E02128)',
      },
      "borderRadius": {
        'none': '0px',
        'sm': '2px', 
        'md': '4px',
        'lg': '6px',
        'xl': '8px',
        'full': '9999px',
        'badge': '4px',
        'action': '4px',
        'container': '8px',
        'overlay': '8px'
      },
      "outlineColor": {
        'brand': 'var(--primary-500, #0067D1)',
        'error': 'var(--error-500, #E02128)'
      },
      "outlineWidth": {
        'focus': '1px',
      },
      "outlineOffset": {
        'gap': '2px',
      },
      "fontSize": {
        "xs": ["10px", { "lineHeight": "1.8" }],
        "sm": ["12px", { "lineHeight": "1.6" }],
        "md": ["14px", { "lineHeight": "1.5" }],
        "lg": ["16px", { "lineHeight": "1.5" }],
        "xl": ["18px", { "lineHeight": "1.5" }],
        "2xl": ["20px", { "lineHeight": "1.4" }],
        "3xl": ["24px", { "lineHeight": "1.4" }],
        "4xl": ["28px", { "lineHeight": "1.4" }],
        "5xl": ["36px", { "lineHeight": "1.4" }],
        "6xl": ["48px", { "lineHeight": "1.3" }],
        "7xl": ["60px", { "lineHeight": "1.3" }],
        "8xl": ["72px", { "lineHeight": "1.2" }],
        "9xl": ["96px", { "lineHeight": "1.2" }]
      }
    }
  },
} satisfies Config