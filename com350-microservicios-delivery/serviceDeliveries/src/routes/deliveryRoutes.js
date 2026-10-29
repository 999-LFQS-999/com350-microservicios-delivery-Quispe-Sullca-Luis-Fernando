const express = require('express');
const router = express.Router();
const Delivery = require('../models/delivery');
const OrdersClient = require('../config/ordersClient');
const { verifyToken, requireRole } = require('./verifyToken');

const VALID_STATUSES = ['asignado', 'recogido', 'en_camino', 'entregado'];

/**
 * GET /api/v1/deliveries?status=
 * Admin: ve todas las entregas (opcionalmente filtradas por status).
 * Repartidor: ve solo sus entregas asignadas (courier_id = id del token).
 */
router.get('/', verifyToken, requireRole('admin', 'repartidor'), async (req, res) => {
  try {
    const filter = {};
    if (req.user.role === 'repartidor') {
      filter.courier_id = req.user.id;
    }
    if (req.query.status) {
      filter.status = req.query.status;
    }

    const deliveries = await Delivery.findAll(filter);
    res.json(deliveries);
  } catch (err) {
    console.error('[deliveries] error en GET /deliveries:', err);
    res.status(500).json({ message: 'Error interno del servidor', error: err.message });
  }
});

/**
 * GET /api/v1/deliveries/order/:orderId
 * Cualquier usuario autenticado: obtiene la entrega asociada a un pedido.
 */
router.get('/order/:orderId', verifyToken, async (req, res) => {
  try {
    const delivery = await Delivery.findByOrderId(Number(req.params.orderId));
    if (!delivery) {
      return res.status(404).json({ message: 'Entrega no encontrada para este pedido' });
    }
    res.json(delivery);
  } catch (err) {
    console.error('[deliveries] error en GET /deliveries/order/:orderId:', err);
    res.status(500).json({ message: 'Error interno del servidor', error: err.message });
  }
});

/**
 * GET /api/v1/deliveries/:id
 * Cualquier usuario autenticado: devuelve la entrega y el detalle del pedido consultado a orders.
 */
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const delivery = await Delivery.findById(Number(req.params.id));
    if (!delivery) {
      return res.status(404).json({ message: 'Entrega no encontrada' });
    }

    // Consultar el pedido al microservicio orders
    let order = null;
    try {
      order = await OrdersClient.getOrder(delivery.order_id, req.headers['authorization']);
    } catch (orderErr) {
      console.warn(`[deliveries] no se pudo obtener el pedido ${delivery.order_id}:`, orderErr.message);
    }

    res.json({
      ...delivery,
      order
    });
  } catch (err) {
    console.error('[deliveries] error en GET /deliveries/:id:', err);
    res.status(500).json({ message: 'Error interno del servidor', error: err.message });
  }
});

/**
 * POST /api/v1/deliveries
 * Solo admin: asigna una entrega a un pedido.
 * Body: { order_id, courier_id, courier_name, notes? }
 */
router.post('/', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const { order_id, courier_id, courier_name, notes } = req.body;

    if (!order_id || !courier_id || !courier_name) {
      return res.status(400).json({ message: 'Faltan campos requeridos: order_id, courier_id, courier_name' });
    }

    const orderIdNum = Number(order_id);

    // 1) Consultar a orders si el pedido existe y su estado
    let order;
    try {
      order = await OrdersClient.getOrder(orderIdNum, req.headers['authorization']);
    } catch (err) {
      return res.status(500).json({ message: 'Error al comunicarse con el microservicio orders', error: err.message });
    }

    if (!order) {
      return res.status(404).json({ message: 'El pedido no existe' });
    }

    // Debe estar confirmado o en_preparacion para poder asignarse
    if (!['confirmado', 'en_preparacion'].includes(order.status)) {
      return res.status(409).json({
        message: `El pedido no esta listo para entrega (estado actual: ${order.status})`
      });
    }

    // 2) Verificar si ya tiene entrega
    const existing = await Delivery.findByOrderId(orderIdNum);
    if (existing) {
      return res.status(409).json({ message: 'El pedido ya tiene una entrega asignada' });
    }

    // 3) Crear la entrega en PostgreSQL
    const newDelivery = await Delivery.create({
      order_id: orderIdNum,
      courier_id: String(courier_id),
      courier_name: String(courier_name),
      notes: notes || null
    });

    res.status(201).json(newDelivery);
  } catch (err) {
    console.error('[deliveries] error en POST /deliveries:', err);
    // Si la BD lanza error de clave unica (uq_delivery_order)
    if (err.code === '23505') {
      return res.status(409).json({ message: 'El pedido ya tiene una entrega asignada' });
    }
    res.status(500).json({ message: 'Error interno del servidor', error: err.message });
  }
});

/**
 * PUT /api/v1/deliveries/:id/status
 * Solo el repartidor asignado (o admin) puede avanzar el estado.
 * Estados permitidos: recogido, en_camino, entregado.
 * Propaga a orders mediante PATCH /orders/:id/status.
 */
router.put('/:id/status', verifyToken, requireRole('repartidor', 'admin'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status } = req.body;

    const allowedNext = ['recogido', 'en_camino', 'entregado'];
    if (!status || !allowedNext.includes(status)) {
      return res.status(400).json({ message: `Estado invalido. Debe ser uno de: ${allowedNext.join(', ')}` });
    }

    const delivery = await Delivery.findById(id);
    if (!delivery) {
      return res.status(404).json({ message: 'Entrega no encontrada' });
    }

    // Validar propiedad si es repartidor
    if (req.user.role === 'repartidor' && delivery.courier_id !== req.user.id) {
      return res.status(403).json({ message: 'No tiene permiso para modificar esta entrega (no le pertenece)' });
    }

    // No se puede modificar si ya está entregado
    if (delivery.status === 'entregado') {
      return res.status(409).json({ message: 'La entrega ya esta en estado entregado (final)' });
    }

    // Solo se permite avanzar en el flujo (asignado -> recogido -> en_camino -> entregado)
    const currentIndex = VALID_STATUSES.indexOf(delivery.status);
    const newIndex = VALID_STATUSES.indexOf(status);

    if (newIndex <= currentIndex) {
      return res.status(409).json({
        message: `No se puede pasar de '${delivery.status}' a '${status}' (no se puede retroceder)`
      });
    }

    // 1) Actualizar entrega en PostgreSQL
    const updated = await Delivery.updateStatus(id, status);

    // 2) Propagar al microservicio orders
    // recogido o en_camino ponen el pedido en "en_camino"; entregado lo pone en "entregado"
    const targetOrderStatus = status === 'entregado' ? 'entregado' : 'en_camino';
    let orderSync = { ok: true, status: targetOrderStatus };

    try {
      const syncResult = await OrdersClient.updateOrderStatus(
        delivery.order_id,
        targetOrderStatus,
        req.headers['authorization']
      );
      orderSync.ok = syncResult.ok;
      orderSync.status = targetOrderStatus;
      if (!syncResult.ok) {
        orderSync.error = syncResult.data;
        console.warn(`[deliveries] sincronizacion parcial con orders:`, syncResult);
      }
    } catch (syncErr) {
      orderSync.ok = false;
      orderSync.error = syncErr.message;
      console.error(`[deliveries] error al sincronizar con orders:`, syncErr.message);
    }

    res.json({
      ...updated,
      orderSync
    });
  } catch (err) {
    console.error('[deliveries] error en PUT /deliveries/:id/status:', err);
    res.status(500).json({ message: 'Error interno del servidor', error: err.message });
  }
});

/**
 * DELETE /api/v1/deliveries/:id
 * Solo admin: elimina la entrega.
 */
router.delete('/:id', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const deleted = await Delivery.remove(id);
    if (!deleted) {
      return res.status(404).json({ message: 'Entrega no encontrada' });
    }
    res.json({ success: true, message: 'Entrega eliminada', id });
  } catch (err) {
    console.error('[deliveries] error en DELETE /deliveries/:id:', err);
    res.status(500).json({ message: 'Error interno del servidor', error: err.message });
  }
});

module.exports = router;
