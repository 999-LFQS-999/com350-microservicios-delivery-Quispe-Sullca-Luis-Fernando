const ORDERS_URL = (process.env.ORDERS_URL || 'http://localhost:8000/api/v1').replace(/\/$/, '');

/**
 * Cliente HTTP sincrónico hacia el microservicio orders usando fetch nativo de Node.js.
 * Reenvía el header Authorization tal como llegó.
 */
class OrdersClient {
  /**
   * Obtiene un pedido por su ID.
   * Devuelve el objeto del pedido o null si es 404.
   */
  static async getOrder(orderId, authHeader) {
    const res = await fetch(`${ORDERS_URL}/orders/${orderId}`, {
      method: 'GET',
      headers: {
        'Authorization': authHeader,
        'Accept': 'application/json'
      }
    });

    if (res.status === 404) {
      return null;
    }

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Error en servicio orders (${res.status}): ${errorText}`);
    }

    return await res.json();
  }

  /**
   * Actualiza el estado del pedido en el servicio orders.
   * Envía PATCH /orders/:id/status { status }
   */
  static async updateOrderStatus(orderId, status, authHeader) {
    const res = await fetch(`${ORDERS_URL}/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ status })
    });

    const data = await res.json().catch(() => null);

    return {
      ok: res.ok,
      status: res.status,
      data
    };
  }
}

module.exports = OrdersClient;
