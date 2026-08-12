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
