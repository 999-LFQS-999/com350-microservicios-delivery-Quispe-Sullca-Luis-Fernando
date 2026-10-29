const pool = require('../config/db');

/**
 * Modelo Delivery: consultas SQL parametrizadas sobre la tabla deliveries en bd_entregas (PostgreSQL).
 */
const Delivery = {
  async findAll({ courier_id, status } = {}) {
    let sql = 'SELECT * FROM deliveries WHERE 1=1';
    const params = [];

    if (courier_id) {
      params.push(courier_id);
      sql += ` AND courier_id = $${params.length}`;
    }

    if (status) {
      params.push(status);
      sql += ` AND status = $${params.length}`;
    }

    sql += ' ORDER BY assigned_at DESC';
    const result = await pool.query(sql, params);
    return result.rows;
  },

  async findById(id) {
    const result = await pool.query('SELECT * FROM deliveries WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  async findByOrderId(orderId) {
    const result = await pool.query('SELECT * FROM deliveries WHERE order_id = $1', [orderId]);
    return result.rows[0] || null;
  },

  async create({ order_id, courier_id, courier_name, notes }) {
    const sql = `
      INSERT INTO deliveries (order_id, courier_id, courier_name, notes, status, assigned_at)
      VALUES ($1, $2, $3, $4, 'asignado', NOW())
      RETURNING *
    `;
    const result = await pool.query(sql, [order_id, courier_id, courier_name, notes || null]);
    return result.rows[0];
  },

  async updateStatus(id, status) {
    let sql;
    let params;

    if (status === 'entregado') {
      sql = `
        UPDATE deliveries
        SET status = $1, delivered_at = NOW()
        WHERE id = $2
        RETURNING *
      `;
      params = [status, id];
    } else {
      sql = `
        UPDATE deliveries
        SET status = $1
        WHERE id = $2
        RETURNING *
      `;
      params = [status, id];
    }

    const result = await pool.query(sql, params);
    return result.rows[0] || null;
  },

  async remove(id) {
    const result = await pool.query('DELETE FROM deliveries WHERE id = $1 RETURNING id', [id]);
    return (result.rowCount || 0) > 0;
  }
};

module.exports = Delivery;
