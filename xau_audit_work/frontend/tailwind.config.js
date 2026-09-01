/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./public/index.html"
  ],
  theme: {
  	extend: {
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		colors: {
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			},
  			// ── XauCloud design system ──────────────────────────────────
  			// Refined metallic gold (NOT muddy amber). gold-300 is the brand
  			// primary; gold-600 for borders/secondary emphasis.
  			gold: {
  				50:  '#FBF3DD',
  				100: '#F7E7BD',
  				200: '#F1D593',
  				300: '#F3C969',
  				400: '#E8B84E',
  				500: '#D4A23A',
  				600: '#C9962E',
  				700: '#A87A24',
  				800: '#7C591B',
  				900: '#4F3A12',
  				DEFAULT: '#F3C969'
  			},
  			// Deep-black surfaces. `ink` = page, `panel` = card, `panel2` = raised.
  			ink:    '#050507',
  			panel:  '#0D0E13',
  			panel2: '#14161C',
  			// Semantic status (green profit / red loss) — used deliberately,
  			// never as decoration.
  			profit: '#34D399',
  			loss:   '#F87171'
  		},
  		keyframes: {
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			},
  			'sheet-up': {
  				from: { transform: 'translateY(100%)' },
  				to:   { transform: 'translateY(0)' }
  			},
  			'fade-in': {
  				from: { opacity: '0' },
  				to:   { opacity: '1' }
  			},
  			'scale-in': {
  				from: { opacity: '0', transform: 'scale(0.96)' },
  				to:   { opacity: '1', transform: 'scale(1)' }
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out',
  			'sheet-up': 'sheet-up 0.26s cubic-bezier(0.32, 0.72, 0, 1)',
  			'fade-in': 'fade-in 0.2s ease-out',
  			'scale-in': 'scale-in 0.18s cubic-bezier(0.32, 0.72, 0, 1)'
  		}
  	}
  },
  plugins: [require("tailwindcss-animate")],
};