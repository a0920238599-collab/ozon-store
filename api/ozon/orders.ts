import { VercelRequest, VercelResponse } from "@vercel/node";
import axios from "axios";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS configuration
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { clientId, apiKey, dateFrom, dateTo } = req.body;

    if (!clientId || !apiKey || !dateFrom || !dateTo) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    const headers = {
      "Client-Id": String(clientId),
      "Api-Key": String(apiKey),
      "Content-Type": "application/json",
    };

    const filter = {
      since: new Date(dateFrom).toISOString(),
      to: new Date(dateTo).toISOString(),
    };

    let allOrders: any[] = [];
    let offset = 0;
    const limit = 1000;
    let hasMore = true;

    // Fetch FBS orders
    while (hasMore) {
      try {
        const response = await axios.post(
          "https://api-seller.ozon.ru/v3/posting/fbs/list",
          {
            dir: "ASC",
            filter,
            limit,
            offset,
            with: { analytics_data: true, financial_data: true }
          },
          { headers, timeout: 30000 }
        );

        const { result, has_next } = response.data;
        if (result && result.postings) {
           allOrders = allOrders.concat(result.postings.map((p: any) => ({ ...p, source: 'fbs' })));
        }

        hasMore = has_next;
        if (hasMore) offset += limit;
      } catch (fbsError: any) {
        const ozonErr = fbsError.response?.data?.error || fbsError.response?.data;
        const status = fbsError.response?.status;
        if (status === 401 || status === 403 || status === 400) {
           return res.status(status).json({ 
             error: `获取 FBS 失败 (状态码 ${status})。错误详情: ${typeof ozonErr === 'object' ? JSON.stringify(ozonErr) : ozonErr}` 
           });
        }
        hasMore = false;
      }
    }

    hasMore = true;
    offset = 0;

    // Fetch FBO orders
    while (hasMore) {
      try {
        const response = await axios.post(
          "https://api-seller.ozon.ru/v2/posting/fbo/list",
          {
            dir: "ASC",
            filter,
            limit,
            offset,
            with: { analytics_data: true, financial_data: true }
          },
          { headers, timeout: 30000 }
        );

        const result = response.data.result;
        if (result) {
          allOrders = allOrders.concat(result.map((p: any) => ({ ...p, source: 'fbo' })));
          if (result.length === limit) {
             offset += limit;
             hasMore = true;
          } else {
             hasMore = false;
          }
        } else {
           hasMore = false;
        }

      } catch (fboError: any) {
        const ozonErr = fboError.response?.data?.error || fboError.response?.data;
        const status = fboError.response?.status;
        if ((status === 401 || status === 403 || status === 400) && allOrders.length === 0) {
           return res.status(status).json({ 
             error: `获取 FBO 失败 (状态码 ${status})。错误详情: ${typeof ozonErr === 'object' ? JSON.stringify(ozonErr) : ozonErr}` 
           });
        }
        hasMore = false;
      }
    }

    return res.status(200).json({ success: true, orders: allOrders });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ error: e.message || "Failed to fetch orders" });
  }
}
