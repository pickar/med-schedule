import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';
import App from './App';
import { ErrorBoundary } from './components/ui/ErrorBoundary';

const container = document.getElementById('root');
if (!container) {
  throw new Error('#root 节点缺失，请检查 index.html');
}

// ErrorBoundary 必须包在最外层：它要能接住 AppProvider 自身（含首屏读盘 / 归一化）
// 抛出的异常。放到 App 内部就晚了 —— 那时白屏已经发生（QA-BUG-01）。
createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

// 注册 Service Worker：仅生产构建启用。
// 目的：让安卓 Chrome 满足「可安装到主屏」的必要条件（需带 fetch 处理）。
// 本地 dev 不注册，避免缓存干扰 HMR。
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* 注册失败不影响正常使用，仅丧失离线/安装能力 */
    });
  });
}
