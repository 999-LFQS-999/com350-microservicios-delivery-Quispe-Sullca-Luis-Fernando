const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: Number(process.env.PG_PORT) || 5432,
  user: process.env.PG_USER || 'delivery',
  password: process.env.PG_PASSWORD || 'delivery123',
  database: process.env.PG_DATABASE || 'bd_entregas',
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.query('SELECT NOW()')
  .then(() => console.log(`[deliveries] conectado a PostgreSQL (${process.env.PG_DATABASE}) en ${process.env.PG_HOST}:${process.env.PG_PORT}`))
  .catch(err => console.error('[deliveries] error al conectar a PostgreSQL:', err.message));

module.exports = pool;
