/**
 * 应用骨架：顶栏 + 左（医生名册）/ 中（排班表）/ 右（洞察面板）三栏。
 *
 * T03 阶段这里只负责**格子**：三块业务区域全是占位块，
 * T04~T06 会逐块换成真实组件。骨架先行的目的是把 CSS Grid 的列宽、
 * 滚动归属、折叠行为一次性调稳——等表格进来再改布局，
 * sticky 表头与冻结首列会被反复打断，代价高得多。
 *
 * 已接通的部分（都属于骨架自身能力，不是业务逻辑）：
 * 月份切换、撤销/重做、面板折叠、保存状态显示、窄屏自动折叠。
 * 把它们接上是为了让骨架**可验证**：打开页面按一下就知道
 * reducer、Context、派生数据、自动保存这条链路是不是通的。
 */

import { AppProvider } from './state/AppProvider';
import { useAppDispatch, useAppState } from './state/contexts';
import { SidePanel } from './components/layout/SidePanel';
import { BackupControls } from './components/layout/BackupControls';
import { TopBar } from './components/layout/TopBar';
import { MainArea } from './components/layout/MainArea';
import { BottomTabBar, tabPanelA11y } from './components/layout/BottomTabBar';
import { InsightPanel } from './components/InsightPanel/InsightPanel';
import { useResponsiveCollapse } from './components/layout/useResponsiveCollapse';
import { useIsMobile } from './components/layout/useIsMobile';
import { Button } from './components/ui/Button';
import { DoctorPanel } from './components/DoctorPanel/DoctorPanel';
import { DoctorDrawer } from './components/DoctorPanel/DoctorDrawer';
import { RulesDrawer } from './components/RulesDrawer/RulesDrawer';
import { TEXTS } from './constants/texts';

export default function App(): React.ReactElement {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
}

function AppShell(): React.ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { doctorPanelCollapsed, insightPanelCollapsed, mobileTab } = state.ui;

  useResponsiveCollapse();
  /*
   * 只用来决定「要不要挂 tabpanel 语义」，不用来决定谁显示谁隐藏——
   * 显隐一律由 CSS 的 data-active-tab 选择器负责，两套断点判断分工必须清晰。
   */
  const isMobile = useIsMobile();

  return (
    <div className="app-shell" data-active-tab={mobileTab}>
      <TopBar />
      <div
        className="app-body"
        data-left={doctorPanelCollapsed ? 'collapsed' : 'expanded'}
        data-right={insightPanelCollapsed ? 'collapsed' : 'expanded'}
      >
        <SidePanel
          side="left"
          title={TEXTS.doctorPanelTitle}
          collapsed={doctorPanelCollapsed}
          a11y={tabPanelA11y('roster', isMobile)}
          onToggle={() =>
            dispatch({
              type: 'ui/patch',
              payload: { doctorPanelCollapsed: !doctorPanelCollapsed },
            })
          }
          footer={
            <>
              <Button
                variant="subtle"
                size="sm"
                icon="userPlus"
                block
                onClick={() => dispatch({ type: 'doctor/loadSamples' })}
              >
                {TEXTS.doctorLoadSamples}
              </Button>
              <BackupControls />
            </>
          }
        >
          <DoctorPanel />
        </SidePanel>

        <MainArea a11y={tabPanelA11y('schedule', isMobile)} />

        <SidePanel
          side="right"
          title={TEXTS.insightTitle}
          collapsed={insightPanelCollapsed}
          a11y={tabPanelA11y('insight', isMobile)}
          onToggle={() =>
            dispatch({
              type: 'ui/patch',
              payload: { insightPanelCollapsed: !insightPanelCollapsed },
            })
          }
        >
          <InsightPanel />
        </SidePanel>
      </div>

      <BottomTabBar />

      <DoctorDrawer />
      <RulesDrawer />
    </div>
  );
}
