# Carrera de Caballos

Base inicial del juego de carrera de caballos para tomar.

## Stack

- React
- Vite
- Firebase Realtime Database
- CSS

## Variables de entorno

Copiar `.env.example` a `.env` y completar:

```bash
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_DATABASE_URL=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

Si no hay variables configuradas, la app usa almacenamiento local como fallback para prototipado.

## Comandos

```bash
npm install
npm run dev
```

## Flujo implementado

- Landing para crear o unirse a una carrera
- Configuración de sala con hasta 6 jugadores o equipos
- Selección de modo `CLASICO` o `RANDOM`
- Configuración de control por dispositivo
- Apuestas iniciales de tragos
- Confirmación de tragos tomados antes de largar
- Hipódromo vertical con 7 niveles de carrera
- Resolución inicial de modo `CLASICO`
- Resolución inicial de modo `RANDOM` con múltiples metodologías
"# Carrera-de-Caballos" 
