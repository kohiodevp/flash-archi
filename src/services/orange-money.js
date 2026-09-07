import axios from 'axios';
import { Buffer } from 'node:buffer';

class OrangeMoneyService {
  constructor() {
    this.baseURL = process.env.ORANGE_API_ENV === 'test' 
      ? 'https://api-s2.orange.com/orangemoney/v1/bf' 
      : 'https://api.orange.com/orangemoney/v1/bf';
    this.oauthURL = process.env.ORANGE_API_ENV === 'test' 
      ? 'https://api-s2.orange.com/oauth/v3/token' 
      : 'https://api.orange.com/oauth/v3/token';

    this.clientId = process.env.ORANGE_CLIENT_ID;
    this.clientSecret = process.env.ORANGE_CLIENT_SECRET;
    this.merchantKey = process.env.ORANGE_MERCHANT_KEY;
    this.simulate = process.env.ORANGE_SIMULATE === 'true' || process.env.ORANGE_API_ENV === 'test';
    this.accessToken = null;
    this.accessTokenExpiresAt = 0;
    this.logger = console; // Basic logger, replace with pino if needed
    // Registre de transactions simulées : token -> statut (démo déterministe).
    this._simulated = new Map();
  }

  get isSimulation() {
    return this.simulate;
  }

  /** Force le statut d'une transaction simulée (outil de test/manuel). */
  simulateSetStatus(token, status) {
    if (this._simulated.has(token)) this._simulated.get(token).status = status;
  }

  async #getAccessToken() {
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt) {
      this.logger.log('Orange Money: Using cached access token.');
      return this.accessToken;
    }

    try {
      this.logger.log('Orange Money: Requesting new access token...');
      const response = await axios.post(this.oauthURL, 'grant_type=client_credentials', {
        headers: {
          'Authorization': 'Basic ' + Buffer.from(this.clientId + ':' + this.clientSecret).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        }
      });
      this.accessToken = response.data.access_token;
      this.accessTokenExpiresAt = Date.now() + (response.data.expires_in * 1000) - 60000; // 1 minute before actual expiry
      this.logger.log('Orange Money: Access token obtained. Expires in:', response.data.expires_in, 'seconds.');
      return this.accessToken;
    } catch (error) {
      this.logger.error('Orange Money: Failed to get access token:', error.response?.data || error.message);
      throw new Error('Failed to get Orange Money access token.');
    }
  }

  async createPayment(orderId, amount, description, customerPhone, customerEmail) {
    // Mode simulation (démo déterministe, sans réseau ni credentials).
    if (this.simulate) {
      const token = `sim_${orderId.replaceAll('-', '').slice(0, 16)}`;
      const payload = { token, status: 'PENDING', webpay_url: `https://pay.orange.test/?token=${token}`, amount, order_id: orderId };
      this._simulated.set(token, payload);
      this.logger.log(`[orange-money:SIM] payment created for ${orderId} (${amount} XOF)`);
      return payload;
    }

    if (!this.merchantKey) {
      throw new Error('Orange Money merchant key is not configured.');
    }
    try {
      const accessToken = await this.#getAccessToken();
      this.logger.log('Orange Money: Creating payment for order:', orderId, 'amount:', amount);
      const response = await axios.post(
        `${this.baseURL}/webpayment`,
        {
          merchant_key: this.merchantKey,
          currency: 'XOF',
          order_id: orderId,
          amount: amount,
          return_url: process.env.ORANGE_RETURN_URL || 'https://app.flash-archi.com/checkout/success',
          cancel_url: process.env.ORANGE_CANCEL_URL || 'https://app.flash-archi.com/checkout/cancel',
          notif_url: process.env.ORANGE_NOTIF_URL || 'https://api.flash-archi.com/api/payment/orange/webhook',
          lang: 'fr',
          reference: 'FlashArchi-' + orderId,
          message: description
        },
        {
          headers: {
            'Authorization': 'Bearer ' + accessToken,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          }
        }
      );
      this.logger.log('Orange Money: Payment creation response:', response.data);
      return response.data; // { webpay_url, token, status }
    } catch (error) {
      this.logger.error('Orange Money: Failed to create payment:', error.response?.data || error.message);
      throw new Error('Failed to create Orange Money payment: ' + (error.response?.data?.message || error.message));
    }
  }

  async checkPaymentStatus(token) {
    // Mode simulation : par défaut un paiement est considéré APPROUVÉ
    // (l'utilisateur a validé sur son téléphone). Permet de forcer d'autres
    // états via simulateSetStatus pour tester les chemins d'erreur.
    if (this.simulate) {
      const rec = this._simulated.get(token);
      const status = rec && rec.status !== 'PENDING' ? rec.status : 'SUCCESSFUL';
      this.logger.log(`[orange-money:SIM] status for ${token}: ${status}`);
      return { ...rec, status, amount: rec?.amount, txid: token };
    }

    try {
      const accessToken = await this.#getAccessToken();
      this.logger.log('Orange Money: Checking payment status for token:', token);
      const response = await axios.get(
        `${this.baseURL}/webpayment?token=${token}`,
        {
          headers: {
            'Authorization': 'Bearer ' + accessToken,
            'Accept': 'application/json'
          }
        }
      );
      this.logger.log('Orange Money: Payment status response:', response.data);
      return response.data; // { status: 'SUCCESSFUL' | 'PENDING' | 'FAILED', ... }
    } catch (error) {
      this.logger.error('Orange Money: Failed to check payment status:', error.response?.data || error.message);
      throw new Error('Failed to check Orange Money payment status: ' + (error.response?.data?.message || error.message));
    }
  }
}

export default new OrangeMoneyService();