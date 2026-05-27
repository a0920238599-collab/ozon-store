import { useState } from 'react';
import axios from 'axios';
import { format } from 'date-fns';
import { Download, Loader2, Database, BarChart3, Settings } from 'lucide-react';
import * as XLSX from 'xlsx';

type ProcessedProduct = {
  clientId: string;
  postingNumber: string;
  source: string;
  status: string;
  sku: string;
  offerId: string; // 货号
  name: string;
  price: number;
  quantity: number;
  currency: string;
  createdAt: string;
};

type SkuSummary = {
  sku: string;
  offerId: string;
  name: string;
  totalQuantity: number;
  totalSales: number;
  currency: string;
};

const App = () => {
  const [credentialsText, setCredentialsText] = useState(() => localStorage.getItem('ozon_credentials') || '');
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return format(d, 'yyyy-MM-dd');
  });
  const [dateTo, setDateTo] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [products, setProducts] = useState<ProcessedProduct[]>([]);
  const [summaries, setSummaries] = useState<SkuSummary[]>([]);

  const handleSaveCredentials = () => {
    localStorage.setItem('ozon_credentials', credentialsText);
  };

  const parseCredentials = (text: string) => {
    const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
    const creds = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // delimiter could be space, tab, comma, colon, vertical bar
      const parts = line.split(/[\t\s,，:：|]+/).filter(Boolean);
      
      if (parts.length >= 2) {
        // Find the first two parts of the line as ID and Key
        creds.push({ clientId: parts[0], apiKey: parts[1] });
      } else if (parts.length === 1) {
        // If the current line has exactly 1 part, check if the next line also has exactly 1 part
        if (i + 1 < lines.length) {
          const nextLine = lines[i + 1];
          const nextParts = nextLine.split(/[\t\s,，:：|]+/).filter(Boolean);
          if (nextParts.length >= 1) {
             creds.push({ clientId: parts[0], apiKey: nextParts[0] });
             i++; // Skip the next line as it was consumed
          }
        }
      }
    }
    return creds;
  };

  const parseOrders = (orders: any[]) => {
    const parsedProducts: ProcessedProduct[] = [];
    const summaryMap = new Map<string, SkuSummary>();

    orders.forEach(order => {
      const clientId = order.clientId || '-';
      const postingNumber = order.posting_number;
      const status = order.status;
      const source = order.source;
      const createdAt = order.in_process_at || order.created_at || '';
      
      const orderProducts = order.products || [];
      
      orderProducts.forEach((prod: any) => {
        const sku = String(prod.sku || '');
        const offerId = prod.offer_id || '';
        const name = prod.name || '';
        const price = parseFloat(prod.price || '0');
        const quantity = parseInt(String(prod.quantity || '0'), 10);
        const currency = prod.currency_code || 'RUB';

        parsedProducts.push({
          clientId,
          postingNumber,
          source: source.toUpperCase(),
          status,
          sku,
          offerId,
          name,
          price,
          quantity,
          currency,
          createdAt: createdAt ? format(new Date(createdAt), 'yyyy-MM-dd HH:mm:ss') : ''
        });

        const summaryKey = `${sku}_${currency}`;
        if (summaryMap.has(summaryKey)) {
          const s = summaryMap.get(summaryKey)!;
          s.totalQuantity += quantity;
          s.totalSales += (price * quantity);
        } else {
          summaryMap.set(summaryKey, {
            sku,
            offerId,
            name,
            totalQuantity: quantity,
            totalSales: price * quantity,
            currency
          });
        }
      });
    });

    setProducts(parsedProducts);
    setSummaries(Array.from(summaryMap.values()).sort((a, b) => b.totalQuantity - a.totalQuantity));
  };

  const fetchOrders = async () => {
    const credentials = parseCredentials(credentialsText);
    if (credentials.length === 0 || !dateFrom || !dateTo) {
      setError("输入格式不匹配：请粘贴至少一组有效的店铺配置 (ID 和 API Key)。如果在两行内输入，请确保格式正确。");
      return;
    }
    
    setError(null);
    setLoading(true);
    handleSaveCredentials();
    
    try {
      const fromDate = new Date(`${dateFrom}T00:00:00Z`);
      const toDate = new Date(`${dateTo}T23:59:59Z`);

      let allOrders: any[] = [];
      let fetchErrors: string[] = [];

      for (const cred of credentials) {
        try {
          const res = await axios.post('/api/ozon/orders', {
            clientId: cred.clientId,
            apiKey: cred.apiKey,
            dateFrom: fromDate.toISOString(),
            dateTo: toDate.toISOString()
          });

          if (res.data && res.data.success) {
            allOrders = allOrders.concat(res.data.orders.map((o: any) => ({ ...o, clientId: cred.clientId })));
          } else {
            fetchErrors.push(`店铺 ${cred.clientId} 失败: ${res.data.error}`);
          }
        } catch (err: any) {
           let errorMsg = "未知错误";
           if (err.response?.data?.error) {
             const errData = err.response.data.error;
             errorMsg = typeof errData === 'object' ? JSON.stringify(errData) : errData;
           } else if (err.response?.data?.message) {
             errorMsg = err.response.data.message;
           } else if (err.response?.data) {
             errorMsg = typeof err.response.data === 'string' ? err.response.data : JSON.stringify(err.response.data);
           } else {
             errorMsg = err.message;
           }
           fetchErrors.push(`店铺 ${cred.clientId} 错误: ${errorMsg}`);
        }
      }

      if (allOrders.length > 0) {
        parseOrders(allOrders);
      } else {
        setProducts([]);
        setSummaries([]);
      }

      if (fetchErrors.length > 0) {
        setError(fetchErrors.join('\n'));
      } else if (allOrders.length === 0) {
        setError("所选时间段内所有店铺均未找到订单数据");
      }
    } catch (err: any) {
      setError(err.message || "请求发生错误");
    } finally {
      setLoading(false);
    }
  };

  const exportProductsToExcel = () => {
    if (products.length === 0) return;
    
    const worksheetData = products.map(p => ({
      "店铺 ID (Client ID)": p.clientId,
      "订单号 (Posting Number)": p.postingNumber,
      "订单来源 (Source)": p.source,
      "订单状态 (Status)": p.status,
      "货号 (Offer ID)": p.offerId,
      "SKU": p.sku,
      "产品名称 (Name)": p.name,
      "单价 (Price)": p.price,
      "数量 (Quantity)": p.quantity,
      "币种 (Currency)": p.currency,
      "创建时间 (Created At)": p.createdAt,
    }));

    const ws = XLSX.utils.json_to_sheet(worksheetData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "订单产品明细");
    XLSX.writeFile(wb, `Ozon_Orders_${dateFrom}_${dateTo}.xlsx`);
  };

  const exportSummaryToExcel = () => {
    if (summaries.length === 0) return;

    const worksheetData = summaries.map(s => ({
      "货号 (Offer ID)": s.offerId,
      "SKU": s.sku,
      "产品名称 (Name)": s.name,
      "总销量 (Total Quantity)": s.totalQuantity,
      "总销售额 (Total Sales)": Number(s.totalSales.toFixed(2)),
      "币种 (Currency)": s.currency
    }));

    const ws = XLSX.utils.json_to_sheet(worksheetData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "SKU销量汇总");
    XLSX.writeFile(wb, `Ozon_SKU_Summary_${dateFrom}_${dateTo}.xlsx`);
  };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 font-sans p-6 md:p-10">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-end justify-between border-b border-neutral-200 pb-6 gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-neutral-900">Ozon 订单抓取与统计</h1>
            <p className="text-neutral-500 mt-2">快速提取 Ozon 店铺的 FBS/FBO 订单数据，并按 SKU 分析销量。</p>
          </div>
        </header>

        <main className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Left Column: Configuration */}
          <div className="space-y-6 lg:col-span-1 border border-neutral-200 bg-white rounded-xl shadow-sm p-6 self-start">
            <h2 className="text-xl font-semibold flex items-center gap-2 mb-4">
              <Settings className="w-5 h-5 text-blue-600" />
              店铺配置
            </h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1">复制并粘贴店铺信息</label>
                <div className="text-xs text-neutral-500 mb-2">
                  支持多店铺批量查询，请粘贴两列数据：<br/>第一列为 <b>Client ID</b>，第二列为 <b>API Key</b>
                </div>
                <textarea
                  value={credentialsText}
                  onChange={(e) => setCredentialsText(e.target.value)}
                  placeholder="示例:&#10;123456    api-key-here-123&#10;789012    api-key-here-456"
                  rows={8}
                  className="w-full px-4 py-3 font-mono text-sm border border-neutral-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none transition resize-y"
                />
              </div>
            </div>

            <div className="pt-4 border-t border-neutral-100 mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">开始日期</label>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="w-full px-4 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none transition"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">结束日期</label>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="w-full px-4 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none transition"
                  />
                </div>
              </div>
            </div>

            <div className="pt-4">
              <button
                onClick={fetchOrders}
                disabled={loading}
                className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-sm transition disabled:opacity-70 flex justify-center items-center gap-2"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Database className="w-5 h-5" />}
                {loading ? '获取中...' : '拉取订单数据'}
              </button>
              
              {error && (
                <div className="mt-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm border border-red-100">
                  {error}
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Results */}
          <div className="lg:col-span-2 space-y-8">
            
            {/* SKU Summary Section */}
            <div className="bg-white border flex flex-col items-center justify-center gap-2 border-neutral-200 rounded-xl shadow-sm overflow-hidden min-h-[300px]">
               {products.length === 0 && !loading && !error && (
                 <div className="text-neutral-400 flex flex-col items-center">
                    <Database className="w-12 h-12 mb-3 text-neutral-300" />
                    <p>请输入配置并点击“拉取订单数据”开始抓取</p>
                 </div>
               )}
               {loading && (
                 <div className="text-blue-500 flex flex-col items-center">
                    <Loader2 className="w-12 h-12 mb-3 animate-spin" />
                    <p>数据请求中，请稍候...</p>
                 </div>
               )}
               {products.length > 0 && !loading && (
                 <div className="w-full h-full p-6 flex flex-col">
                   <div className="flex justify-between items-center mb-4">
                     <h3 className="text-lg font-semibold flex items-center gap-2">
                       <BarChart3 className="w-5 h-5 text-indigo-500" />
                       SKU 汇总统计
                       <span className="text-sm font-normal text-neutral-500 bg-neutral-100 px-2 py-0.5 rounded-full">
                         共 {summaries.length} 个 SKU
                       </span>
                     </h3>
                     <button
                       onClick={exportSummaryToExcel}
                       className="text-sm flex items-center gap-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-medium py-1.5 px-3 rounded-lg transition"
                     >
                       <Download className="w-4 h-4" />
                       导出汇总 (Excel)
                     </button>
                   </div>
                   
                   <div className="overflow-x-auto border border-neutral-200 rounded-lg">
                     <table className="w-full text-sm text-left">
                       <thead className="bg-neutral-50 text-neutral-600 uppercase font-medium">
                         <tr>
                           <th className="px-4 py-3">货号</th>
                           <th className="px-4 py-3">SKU</th>
                           <th className="px-4 py-3 text-right">总销量</th>
                           <th className="px-4 py-3 text-right">总销售额</th>
                         </tr>
                       </thead>
                       <tbody className="divide-y divide-neutral-200">
                         {summaries.slice(0, 10).map((s, idx) => (
                           <tr key={idx} className="hover:bg-neutral-50/50">
                             <td className="px-4 py-3 font-medium text-neutral-800">{s.offerId || '-'}</td>
                             <td className="px-4 py-3 font-mono text-neutral-500">{s.sku}</td>
                             <td className="px-4 py-3 text-right font-medium">{s.totalQuantity}</td>
                             <td className="px-4 py-3 text-right text-green-600 font-medium">
                               {s.totalSales.toFixed(2)} {s.currency}
                             </td>
                           </tr>
                         ))}
                       </tbody>
                     </table>
                     {summaries.length > 10 && (
                       <div className="p-3 text-center text-xs text-neutral-500 bg-neutral-50">
                          显示前 10 条数据。导出 Excel 可查看完整列表 ({summaries.length} 项)。
                       </div>
                     )}
                   </div>
                 </div>
               )}
            </div>

            {/* Detailed Orders Section */}
            {products.length > 0 && !loading && (
             <div className="bg-white border border-neutral-200 rounded-xl shadow-sm p-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <Database className="w-5 h-5 text-blue-500" />
                    订单产品明细
                    <span className="text-sm font-normal text-neutral-500 bg-neutral-100 px-2 py-0.5 rounded-full">
                      共 {products.length} 条
                    </span>
                  </h3>
                  <button
                    onClick={exportProductsToExcel}
                    className="text-sm flex items-center gap-2 bg-blue-50 hover:bg-blue-100 text-blue-700 font-medium py-1.5 px-3 rounded-lg transition"
                  >
                    <Download className="w-4 h-4" />
                    导出明细 (Excel)
                  </button>
                </div>

                <div className="overflow-x-auto border border-neutral-200 rounded-lg">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-neutral-50 text-neutral-600 uppercase font-medium">
                      <tr>
                        <th className="px-4 py-3">店铺 ID</th>
                        <th className="px-4 py-3">订单号</th>
                        <th className="px-4 py-3">来源</th>
                        <th className="px-4 py-3">货号</th>
                        <th className="px-4 py-3 text-right">单价</th>
                        <th className="px-4 py-3 text-right">数量</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-200">
                      {products.slice(0, 10).map((p, idx) => (
                        <tr key={idx} className="hover:bg-neutral-50/50">
                          <td className="px-4 py-3 font-medium text-neutral-800">{p.clientId}</td>
                          <td className="px-4 py-3 font-mono text-neutral-600">{p.postingNumber}</td>
                          <td className="px-4 py-3">
                             <span className={`px-2 py-0.5 rounded text-xs font-medium ${p.source === 'FBS' ? 'bg-amber-100 text-amber-700' : 'bg-cyan-100 text-cyan-700'}`}>
                               {p.source}
                             </span>
                          </td>
                          <td className="px-4 py-3 font-medium text-neutral-800">{p.offerId || '-'}</td>
                          <td className="px-4 py-3 text-right text-neutral-600">{p.price} {p.currency}</td>
                          <td className="px-4 py-3 text-right font-medium">{p.quantity}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {products.length > 10 && (
                    <div className="p-3 text-center text-xs text-neutral-500 bg-neutral-50">
                       显示前 10 条明细。导出 Excel 可查看完整列表 ({products.length} 项)。
                    </div>
                  )}
                </div>
             </div>
            )}

          </div>

        </main>
      </div>
    </div>
  );
};

export default App;
