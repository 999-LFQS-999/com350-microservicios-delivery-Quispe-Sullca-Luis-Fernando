require('dotenv').config();
const express = require('express');
const deliveryRoutes = require('./routes/deliveryRoutes');

const app = express();
app.set('port', process.env.PORT || 3004);

// middlewares
app.use(express.json());
app.use((req, res, next) => {
  console.log(`[deliveries] ${req.method} ${req.originalUrl}`);
  next();
});

// rutas (el prefijo /api/v1/deliveries coincide con nginx)
app.use('/api/v1/deliveries', deliveryRoutes);

// estado del servicio
app.get('/', (req, res) => {
  res.json({ service: 'deliveries', database: 'PostgreSQL (bd_entregas)' });
});

app.use((req, res) => res.status(404).json({ message: 'Ruta no encontrada en deliveries' }));

app.listen(app.get('port'), () => {
  console.log('[deliveries] servidor escuchando en el puerto', app.get('port'));
});
