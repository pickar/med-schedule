/**
 * 「生成排班」的完整交互：按钮 + 三条分支 + 结果反馈。
 *
 * 三条分支对应用户当下真实处境，缺一条就会出事：
 * 1. **名册为空** —— 直接 toast「请先添加至少 1 位医生」。
 *    生成器自己也拦得住（会回一条 high 诊断），但那时用户已经等了 300ms
 *    才收到一句「不行」，白等一场。前置拦截是为了让拒绝来得更快。
 * 2. **本月已有排班** —— 弹确认框。生成是**覆盖式**操作，手动调整会被冲掉；
 *    有锁定格时补一句「已锁定 N 格将被保留」，用户才敢按下确认。
 * 3. **空月** —— 无需确认，直接生成。没有任何东西会被毁掉。
 *
 * ## 为什么要有 300ms 的 loading 地板
 *
 * `generateSchedule()` 是同步纯函数，30 人 × 31 天通常几十毫秒就跑完。
 * 快到「按钮闪一下就结束」，用户会怀疑自己是不是没点上、于是再点一次。
 * 这里用 `Promise.all([计算, sleep(300)])` 给一个最短可见时长：
 * 不是假装很忙，是让「我确实做了一轮」这件事被看见。
 *
 * 计算前先 `await nextPaint()`：同步重活会锁住主线程，不先让出一帧，
 * 那个 loading 态根本没机会绘制出来，地板也就白铺了。
 */

import { useCallback, useRef, useState } from 'react';
import type { Diagnostic } from '../../types/domain';
import { useAppDispatch, useAppState, useToast } from '../../state/contexts';
import {
  selectHasNoDoctor,
  selectHasSchedule,
  selectLockedCount,
  selectMonthSchedule,
} from '../../state/selectors';
import { generateSchedule } from '../../core/generator';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { Button } from '../ui/Button';
import { TEXTS } from '../../constants/texts';

/** loading 态的最短可见时长（毫秒） */
export const MIN_LOADING_MS = 300;

/**
 * 值得向用户提一嘴的诊断条数。
 *
 * low 级是生成器的内部流水账（「今天没人可排白班的最大值」这类），
 * 计进「N 处需关注」只会把数字撑到用户懒得看。只数 high 与 medium。
 */
export function countNoteworthy(diagnostics: readonly Diagnostic[]): number {
  return diagnostics.filter((item) => item.level !== 'low').length;
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** 让出一帧，确保 loading 态先绘制出来再开始同步重算 */
function nextPaint(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });
}

export function GenerateFlow(): React.ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const toast = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);

  // 回调里一律读 ref 而不是闭包变量：既让 useCallback 的依赖收敛到稳定引用，
  // 也避免 await 之后拿到的是发起那一刻的旧 state
  const stateRef = useRef(state);
  stateRef.current = state;

  const { currentMonth, generating } = state.ui;
  const lockedCount = selectLockedCount(state, currentMonth);

  const run = useCallback(async (): Promise<void> => {
    const snapshot = stateRef.current;
    const month = snapshot.ui.currentMonth;
    const doctorCount = snapshot.doctors.length;
    const monthNumber = Number(month.slice(5, 7));

    dispatch({ type: 'ui/patch', payload: { generating: true } });

    try {
      const compute = (async () => {
        await nextPaint();
        return generateSchedule({
          month,
          doctors: snapshot.doctors,
          rules: snapshot.rules,
          existingSchedule: selectMonthSchedule(snapshot, month),
        });
      })();
      const [result] = await Promise.all([compute, sleep(MIN_LOADING_MS)]);

      // 前置校验失败（月份非法 / 名册为空）时生成器回空表 + 一条 high 诊断。
      // 写空表会把用户原有排班抹掉，这里必须拦住。
      if (Object.keys(result.schedule).length === 0) {
        dispatch({
          type: 'ui/patch',
          payload: { generating: false, lastDiagnostics: result.diagnostics },
        });
        toast.show({
          tone: 'warning',
          message: result.diagnostics[0]?.message ?? TEXTS.noDoctorWarning,
        });
        return;
      }

      dispatch({
        type: 'schedule/applyGenerated',
        payload: { month, entries: result.schedule },
      });
      dispatch({
        type: 'ui/patch',
        payload: { generating: false, lastDiagnostics: result.diagnostics },
      });

      const noteworthy = countNoteworthy(result.diagnostics);
      toast.show({
        tone: noteworthy > 0 ? 'warning' : 'success',
        message:
          noteworthy > 0
            ? TEXTS.generateSuccessWithIssues(monthNumber, doctorCount, noteworthy)
            : TEXTS.generateSuccess(monthNumber, doctorCount),
        detail: result.diagnostics.length === 0 ? TEXTS.generateNoIssue : undefined,
      });
    } catch (reason) {
      // 生成器不该抛，但真抛了也绝不能把按钮永久卡在 loading 上
      dispatch({ type: 'ui/patch', payload: { generating: false } });
      toast.show({
        tone: 'danger',
        message: TEXTS.generateFailed,
        detail: reason instanceof Error ? reason.message : undefined,
      });
    }
  }, [dispatch, toast]);

  const handleClick = useCallback((): void => {
    const snapshot = stateRef.current;
    if (selectHasNoDoctor(snapshot)) {
      toast.show({ tone: 'warning', message: TEXTS.noDoctorWarning });
      return;
    }
    if (selectHasSchedule(snapshot, snapshot.ui.currentMonth)) {
      setConfirmOpen(true);
      return;
    }
    void run();
  }, [run, toast]);

  // 先收起弹窗再开跑：确认框停在原地转圈会让用户以为还能点「取消」撤回，
  // 但覆盖已经不可逆了。按钮上的 loading 才是此刻唯一诚实的状态。
  const handleConfirm = useCallback((): void => {
    setConfirmOpen(false);
    void run();
  }, [run]);

  const handleCancel = useCallback((): void => {
    setConfirmOpen(false);
  }, []);

  return (
    <>
      <Button
        variant="primary"
        icon="sparkles"
        loading={generating}
        onClick={handleClick}
        title={TEXTS.generateButton}
      >
        {generating ? TEXTS.generating : TEXTS.generateButton}
      </Button>

      <ConfirmDialog
        open={confirmOpen}
        title={TEXTS.generateButton}
        message={TEXTS.regenerateConfirm}
        detail={lockedCount > 0 ? TEXTS.regenerateConfirmLocked(lockedCount) : undefined}
        confirmText={TEXTS.generateButton}
        danger
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </>
  );
}
