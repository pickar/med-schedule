/**
 * 全局错误边界（QA-BUG-01 第三层防御）。
 *
 * 前两层（`lib/dataShape.ts` 的形状保证 + `core/stats` 的空值保护）负责让已知的
 * 畸形数据不再抛错；这一层负责**未知**的那些——任何一个渲染期异常，都不该让用户
 * 面对一片空白，更不该在刷新之后依旧空白（脏数据此时已经落盘）。
 *
 * 因此降级 UI 必须做到两件事：
 * 1. 说人话地告诉用户「数据还在、不是你的错」，而不是甩一串英文堆栈。
 * 2. 给一条**能自救的出口**：清空本机数据并重新开始。没有它，用户唯一的选择
 *    就是手动开 DevTools 删 localStorage —— 对着一群医生说这句话等于没说。
 *
 * 刻意不复用 `Button` / `TEXTS` 等应用内模块：错误边界是最后一道网，
 * 它的依赖越少，自身被同一个 bug 波及的概率就越低。样式同理走内联，
 * 即便样式表加载失败也能正常显示。
 */

import { Component } from 'react';
import type { CSSProperties, ErrorInfo, ReactNode } from 'react';
import { STORAGE_NAMESPACE, STORAGE_KEYS } from '../../constants/defaults';
// 唯一破例引入的 UI 模块：Icons 是一张纯常量路径表 + 一个无状态 svg，
// 不碰 Context、不读 storage、不依赖任何业务模块，塌不到这一层来。
import { Icon } from './Icons';

export interface ErrorBoundaryProps {
  children: ReactNode;
}

export interface ErrorBoundaryState {
  /** 非 null 即处于降级态 */
  error: Error | null;
}

/** 从异常值里取一段可读描述，非 Error 对象也能兜住 */
function toError(raw: unknown): Error {
  if (raw instanceof Error) {
    return raw;
  }
  return new Error(typeof raw === 'string' && raw !== '' ? raw : '未知错误');
}

/**
 * 清空本应用写入 localStorage 的全部数据。
 *
 * 用**前缀扫描**而不是 `storage.clearAll()`：后者依赖 meta 里的月份清单定位分月
 * key，而能把页面搞崩的数据，meta 本身往往就是坏的。前缀扫描不依赖任何既有数据
 * 的正确性，是这个场景下唯一可靠的做法。
 *
 * `warmshift:v1:backup` 保留：它存的是历次解析失败的原始串，供事后追溯，
 * 且启动路径从不读取它，留着不影响自救。
 */
export function clearAppStorage(): number {
  let removed = 0;
  try {
    const store = globalThis.localStorage;
    if (!store) {
      return 0;
    }
    const doomed: string[] = [];
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key !== null && key.startsWith(`${STORAGE_NAMESPACE}:`) && key !== STORAGE_KEYS.backup) {
        doomed.push(key);
      }
    }
    for (const key of doomed) {
      store.removeItem(key);
      removed += 1;
    }
  } catch {
    // 隐私模式下 localStorage 不可用：既然读不到也就没有脏数据，直接放行到 reload
  }
  return removed;
}

const wrapStyle: CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '24px',
  background: 'var(--bg-app, #F2F7F9)',
  fontFamily: "var(--font-family, 'Noto Sans SC', 'PingFang SC', system-ui, sans-serif)",
  color: 'var(--text-primary, #0F2A33)',
};

const cardStyle: CSSProperties = {
  maxWidth: '520px',
  width: '100%',
  padding: '32px',
  borderRadius: '16px',
  background: 'var(--bg-surface, #ffffff)',
  border: '1px solid var(--border-light, #E4ECEF)',
  boxShadow: '0 8px 32px rgba(9, 38, 46, 0.12)',
  textAlign: 'center',
};

const titleStyle: CSSProperties = {
  margin: '0 0 12px',
  fontSize: '20px',
  fontWeight: 700,
};

const textStyle: CSSProperties = {
  margin: '0 0 8px',
  fontSize: '14px',
  lineHeight: 1.7,
  color: 'var(--text-secondary, #4A6570)',
};

const actionsStyle: CSSProperties = {
  display: 'flex',
  gap: '12px',
  justifyContent: 'center',
  flexWrap: 'wrap',
  margin: '24px 0 0',
};

const primaryButtonStyle: CSSProperties = {
  padding: '10px 20px',
  borderRadius: '10px',
  border: 'none',
  cursor: 'pointer',
  fontSize: '14px',
  fontWeight: 700,
  fontFamily: 'inherit',
  color: 'var(--text-inverse, #ffffff)',
  background: 'var(--primary-700, #006C7C)',
};

const subtleButtonStyle: CSSProperties = {
  padding: '10px 20px',
  borderRadius: '10px',
  cursor: 'pointer',
  fontSize: '14px',
  fontWeight: 500,
  fontFamily: 'inherit',
  color: 'var(--text-secondary, #4A6570)',
  background: 'transparent',
  border: '1px solid var(--border-strong, #B3C6CD)',
};

const detailStyle: CSSProperties = {
  margin: '20px 0 0',
  textAlign: 'left',
  fontSize: '12px',
  color: 'var(--text-tertiary, #546E78)',
};

const preStyle: CSSProperties = {
  margin: '8px 0 0',
  padding: '10px 12px',
  maxHeight: '160px',
  overflow: 'auto',
  borderRadius: '8px',
  background: 'var(--bg-muted, #EDF3F6)',
  fontFamily: "var(--font-mono, 'Consolas', monospace)",
  fontSize: '11px',
  lineHeight: 1.6,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
};

/**
 * 包在 `<App />` 外层，把渲染期异常转成一屏可操作的降级页。
 *
 * 必须是 class 组件：React 至今没有提供 Hook 形式的错误边界，
 * `componentDidCatch` / `getDerivedStateFromError` 只在类组件上生效。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(raw: unknown): ErrorBoundaryState {
    return { error: toError(raw) };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 控制台留全量线索：降级页只给一句摘要，排查得靠这里
    console.error('[医键排班] 渲染期异常已被错误边界拦截：', error, info.componentStack);
  }

  private readonly handleReset = (): void => {
    clearAppStorage();
    this.reload();
  };

  private readonly handleRetry = (): void => {
    this.reload();
  };

  private reload(): void {
    try {
      globalThis.location.reload();
    } catch {
      // 极端环境（如无 location 的宿主）下退回到就地恢复，至少让用户能继续操作
      this.setState({ error: null });
    }
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }

    return (
      <div style={wrapStyle} role="alert">
        <div style={cardStyle}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              marginBottom: '12px',
              color: 'var(--color-danger, #c62828)',
            }}
            aria-hidden="true"
          >
            <Icon name="alert" size={40} strokeWidth={1.5} />
          </div>
          <h1 style={titleStyle}>页面遇到了一点小状况</h1>
          <p style={textStyle}>
            这不是你的操作问题。本机保存的排班数据里可能有一条格式异常，医键排班没能把它读明白。
          </p>
          <p style={textStyle}>
            可以先试试重新加载。如果刷新之后还是这个页面，说明那条异常数据仍在本机，
            点下面的「清空本地数据并重新开始」即可恢复——请注意，这会清除本机保存的
            医生名册、排班规则与全部月份排班，操作不可撤销。
          </p>
          <div style={actionsStyle}>
            <button type="button" style={primaryButtonStyle} onClick={this.handleReset}>
              清空本地数据并重新开始
            </button>
            <button type="button" style={subtleButtonStyle} onClick={this.handleRetry}>
              先刷新页面试试
            </button>
          </div>
          <details style={detailStyle}>
            <summary style={{ cursor: 'pointer' }}>查看技术细节（反馈问题时请附上）</summary>
            <pre style={preStyle}>{`${error.name}: ${error.message}`}</pre>
          </details>
        </div>
      </div>
    );
  }
}
