(function () {
  const state = {
    productName: 'Teroka Minda Ebook',
    currency: 'MYR',
    defaultAmount: 29,
    website: 'https://terokaminda.com',
    tracking: {},
    payment: {
      provider: 'toyyibpay',
      endpoint: '/api/create-bill'
    }
  };

  function init(config) {
    Object.assign(state, config || {});
    state.tracking = Object.assign({}, state.tracking, config?.tracking || {});
    state.payment = Object.assign({}, state.payment, config?.payment || {});

    if (state.tracking.metaPixelId && !window.fbq) {
      console.warn('Meta Pixel ID is set, but fbq is not loaded yet.');
    }
  }

  function track(eventName, payload) {
    const data = Object.assign({
      product: state.productName,
      currency: state.currency,
      value: state.defaultAmount
    }, payload || {});

    try {
      if (window.fbq) window.fbq('trackCustom', eventName, data);
      if (window.gtag) window.gtag('event', eventName, data);
      if (window.ttq && typeof window.ttq.track === 'function') window.ttq.track(eventName, data);
    } catch (error) {
      console.warn('Tracking error:', error);
    }
  }

  async function checkout(payload) {
    const endpoint = state.payment.endpoint || '/api/create-bill';

    track('InitiateCheckout', {
      value: Number(payload?.amount || state.defaultAmount),
      currency: payload?.currency || state.currency,
      package: payload?.package || 'teroka-minda-ebook'
    });

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });

    let result = null;
    try {
      result = await response.json();
    } catch (error) {
      throw new Error('Server tidak memberi respons JSON yang sah.');
    }

    if (!response.ok || !result?.paymentUrl) {
      throw new Error(result?.message || 'Gagal cipta bill ToyyibPay. Sila cuba lagi.');
    }

    track('ToyyibPayBillCreated', {
      billCode: result.billCode,
      referenceNo: result.referenceNo,
      value: Number(payload?.amount || state.defaultAmount),
      currency: payload?.currency || state.currency
    });

    window.location.href = result.paymentUrl;
  }

  window.TerokaMindaAPI = {
    init,
    track,
    checkout
  };
})();
