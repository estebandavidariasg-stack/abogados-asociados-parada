# Lex Dorado — Bufete de Abogados

Proyecto React + Vite para el sitio web del bufete.

## Requisitos
- Node.js 18+
- npm o yarn

## Instalación y arranque

```bash
# 1. Instalar dependencias
npm install

# 2. Iniciar servidor de desarrollo
npm run dev

# 3. Abrir en el navegador
# http://localhost:5173
```

## Estructura del proyecto

```
src/
├── components/         # Componentes reutilizables
│   ├── Navbar.jsx / .module.css
│   ├── Hero.jsx / .module.css          ← Carrusel principal
│   ├── LawyersSection.jsx / .module.css
│   ├── LawyerCard.jsx / .module.css    ← Tarjeta individual
│   ├── CTASection.jsx / .module.css
│   ├── Footer.jsx / .module.css
│   ├── WhatsAppButton.jsx / .module.css
│   └── AuthModal.jsx / .module.css     ← Login / Registro
├── pages/
│   └── HomePage.jsx                    ← Página pública
├── styles/
│   └── global.css                      ← Variables CSS + utilidades
├── App.jsx                             ← Rutas
└── main.jsx                            ← Entry point
```

## Próximos pasos

- [ ] Conectar Supabase (auth + base de datos)
- [ ] Panel Super Admin (gestión del carrusel y aprobación de abogados)
- [ ] Dashboard del abogado (editar perfil)
- [ ] Subir imágenes reales al carrusel
- [ ] Despliegue en Vercel con dominio personalizado

## Agregar imágenes al carrusel

En `src/components/Hero.jsx`, cada slide tiene un `bgClass`.
En `Hero.module.css` puedes reemplazar el gradiente por una imagen real:

```css
/* Antes */
.slide1 { background: radial-gradient(...), #0d0d0d; }

/* Después */
.slide1 {
  background-image: url('/images/hero-1.jpg');
  background-size: cover;
  background-position: center;
}
```

Coloca las imágenes en la carpeta `/public/images/`.
