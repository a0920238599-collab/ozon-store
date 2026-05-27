import express from "express";
import path from "path";
import axios from "axios";
import cors from "cors";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  app.post("/api/ozon/orders", async (req, res) => {
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
              filter: filter,
              limit,
              offset,
              with: {
                analytics_data: true,
                financial_data: true
              }
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
          console.error("FBS Fetch Error:", fbsError.response?.data || fbsError.message);
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
              filter: filter,
              limit,
              offset,
              with: {
                analytics_data: true,
                financial_data: true
              }
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
          console.error("FBO Fetch Error:", fboError.response?.data || fboError.message);
          const ozonErr = fboError.response?.data?.error || fboError.response?.data;
          const status = fboError.response?.status;
          // If FBO fails with authentication or validation error, report it unless we already have some FBS orders
          if ((status === 401 || status === 403 || status === 400) && allOrders.length === 0) {
             return res.status(status).json({ 
               error: `获取 FBO 失败 (状态码 ${status})。错误详情: ${typeof ozonErr === 'object' ? JSON.stringify(ozonErr) : ozonErr}` 
             });
          }
          hasMore = false;
        }
      }

      res.json({ success: true, orders: allOrders });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message || "Failed to fetch orders" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
