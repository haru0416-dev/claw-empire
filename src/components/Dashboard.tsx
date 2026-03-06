import { useMemo } from "react";
import type { Agent, CompanyRecentActivity, CompanyStats, Task } from "../types";
import { localeName, useI18n } from "../i18n";
import {
  DashboardHeroHeader,
  DashboardHudStats,
  DashboardRankingBoard,
  type HudStat,
  type RankedAgent,
} from "./dashboard/HeroSections";
import {
  DashboardDeptAndSquad,
  DashboardMissionLog,
  type DepartmentPerformance,
  type MissionLogEntry,
} from "./dashboard/OpsSections";
import { DEPT_COLORS, STATUS_LABELS, STATUS_LEFT_BORDER, taskStatusLabel, useNow } from "./dashboard/model";

interface DashboardProps {
  stats: CompanyStats | null;
  agents: Agent[];
  tasks: Task[];
  companyName: string;
  onPrimaryCtaClick: () => void;
}

export default function Dashboard({ stats, agents, tasks, companyName, onPrimaryCtaClick }: DashboardProps) {
  const { t, language, locale: localeTag } = useI18n();
  const { date, time, briefing } = useNow(localeTag, t);
  const agentMap = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);
  const numberFormatter = useMemo(() => new Intl.NumberFormat(localeTag), [localeTag]);

  const totalTasks = stats?.tasks?.total ?? tasks.length;
  const completedTasks = stats?.tasks?.done ?? tasks.filter((task) => task.status === "done").length;
  const inProgressTasks = stats?.tasks?.in_progress ?? tasks.filter((task) => task.status === "in_progress").length;
  const plannedTasks = stats?.tasks?.planned ?? tasks.filter((task) => task.status === "planned").length;
  const reviewTasks = stats?.tasks?.review ?? tasks.filter((task) => task.status === "review").length;
  const pendingTasks = tasks.filter((task) => task.status === "pending").length;
  const activeAgents = stats?.agents?.working ?? agents.filter((agent) => agent.status === "working").length;
  const idleAgents = stats?.agents?.idle ?? agents.filter((agent) => agent.status === "idle").length;
  const totalAgents = stats?.agents?.total ?? agents.length;
  const completionRate =
    stats?.tasks?.completion_rate ?? (totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0);
  const activeRate = totalAgents > 0 ? Math.round((activeAgents / totalAgents) * 100) : 0;
  const reviewQueue = reviewTasks + pendingTasks;

  const primaryCtaLabel = t({ ko: "미션 시작", en: "Start Mission", ja: "ミッション開始", zh: "开始任务" });
  const primaryCtaEyebrow = t({ ko: "빠른 실행", en: "Quick Start", ja: "クイック開始", zh: "快速开始" });
  const primaryCtaDescription = t({
    ko: "핵심 업무를 바로 생성하고 실행으로 전환하세요",
    en: "Create a priority task and move execution immediately.",
    ja: "最優先タスクをすぐ作成して実行へ移行します。",
    zh: "立即创建优先任务并进入执行。",
  });

  const deptData = useMemo<DepartmentPerformance[]>(() => {
    if (stats?.tasks_by_department && stats.tasks_by_department.length > 0) {
      return stats.tasks_by_department
        .map((department, idx) => ({
          id: department.id,
          name: department.name,
          icon: department.icon ?? "🏢",
          done: department.done_tasks,
          total: department.total_tasks,
          ratio: department.total_tasks > 0 ? Math.round((department.done_tasks / department.total_tasks) * 100) : 0,
          color: DEPT_COLORS[idx % DEPT_COLORS.length],
        }))
        .sort((a, b) => b.ratio - a.ratio || b.total - a.total);
    }

    const deptMap = new Map<string, { name: string; icon: string; done: number; total: number }>();
    for (const agent of agents) {
      if (!agent.department_id) continue;
      if (!deptMap.has(agent.department_id)) {
        deptMap.set(agent.department_id, {
          name: agent.department ? localeName(language, agent.department) : agent.department_id,
          icon: agent.department?.icon ?? "🏢",
          done: 0,
          total: 0,
        });
      }
    }
    for (const task of tasks) {
      if (!task.department_id) continue;
      const entry = deptMap.get(task.department_id);
      if (!entry) continue;
      entry.total += 1;
      if (task.status === "done") entry.done += 1;
    }
    return Array.from(deptMap.entries())
      .map(([id, value], idx) => ({
        id,
        ...value,
        ratio: value.total > 0 ? Math.round((value.done / value.total) * 100) : 0,
        color: DEPT_COLORS[idx % DEPT_COLORS.length],
      }))
      .sort((a, b) => b.ratio - a.ratio || b.total - a.total);
  }, [stats, agents, tasks, language]);

  const topAgents = useMemo<RankedAgent[]>(() => {
    if (stats?.top_agents && stats.top_agents.length > 0) {
      return stats.top_agents.slice(0, 5).map((topAgent) => {
        const agent = agentMap.get(topAgent.id);
        return {
          id: topAgent.id,
          name: agent ? localeName(language, agent) : topAgent.name,
          department: agent?.department ? localeName(language, agent.department) : "",
          tasksDone: topAgent.stats_tasks_done,
          xp: topAgent.stats_xp,
        };
      });
    }
    return [...agents]
      .sort((a, b) => b.stats_xp - a.stats_xp)
      .slice(0, 5)
      .map((agent) => ({
        id: agent.id,
        name: localeName(language, agent),
        department: agent.department ? localeName(language, agent.department) : "",
        tasksDone: agent.stats_tasks_done,
        xp: agent.stats_xp,
      }));
  }, [stats, agents, agentMap, language]);

  const maxXp = topAgents.length > 0 ? Math.max(...topAgents.map((agent) => agent.xp), 1) : 1;
  const workingAgents = agents.filter((agent) => agent.status === "working");
  const idleAgentsList = agents.filter((agent) => agent.status === "idle");

  const missionLogEntries = useMemo<MissionLogEntry[]>(() => {
    const getActivityAgentLabel = (activity: CompanyRecentActivity, linkedAgent?: Agent): string => {
      if (linkedAgent) return localeName(language, linkedAgent);
      if (language === "ko") return activity.agent_name_ko || activity.agent_name || t({ ko: "팀원", en: "Teammate" });
      if (language === "ja") return activity.agent_name_ja || activity.agent_name || t({ ko: "팀원", en: "Teammate" });
      if (language === "zh") return activity.agent_name_zh || activity.agent_name || t({ ko: "팀원", en: "Teammate" });
      return activity.agent_name || activity.agent_name_ko || t({ ko: "팀원", en: "Teammate" });
    };

    const isDisplayableActivity = (activity: CompanyRecentActivity): boolean => {
      const kind = String(activity.kind ?? "").toLowerCase();
      const message = String(activity.message ?? "");
      if (kind === "memory" || kind === "failed" || kind === "error" || kind === "completed") return true;
      return /Status\s*(?:→|->)\s*review/i.test(message);
    };

    const buildActivityEntry = (activity: CompanyRecentActivity): MissionLogEntry => {
      const linkedAgent = activity.agent_id ? agentMap.get(activity.agent_id) : undefined;
      const actorLabelBase = getActivityAgentLabel(activity, linkedAgent);
      const taskTitle = String(activity.task_title ?? "").trim();
      const message = String(activity.message ?? "").trim();
      const kind = String(activity.kind ?? "").toLowerCase();
      const isMemory = kind === "memory";
      const isFailure = kind === "failed" || kind === "error" || /RUN failed/i.test(message);
      const isReview = /Status\s*(?:→|->)\s*review/i.test(message);
      const isComplete = kind === "completed" || /RUN completed/i.test(message);

      const title = isMemory
        ? t({
            ko: "새 작업 습관이 남았습니다",
            en: "New habit remembered",
            ja: "新しい仕事の癖を覚えました",
            zh: "记住了新的工作习惯",
          })
        : taskTitle ||
          t({
            ko: "최근 활동",
            en: "Recent activity",
            ja: "最近の活動",
            zh: "最近活动",
          });

      const body = isMemory
        ? t({
            ko: "다음 실행에 쓸 메모를 정리해 두었습니다.",
            en: "Packed away a few notes for the next run.",
            ja: "次の実行に向けたメモを整えておきました。",
            zh: "已经为下一次执行整理好了几条便签。",
          })
        : isFailure
          ? t({
              ko: "작업이 한번 걸렸고, 다시 손봐야 할 상태로 돌아갔습니다.",
              en: "The task hit a snag and bounced back for another pass.",
              ja: "作業が一度引っかかり、もう一度整える段階に戻りました。",
              zh: "任务中途卡了一下，已回到需要再修一轮的状态。",
            })
          : isReview
            ? t({
                ko: "이제 팀 리드가 결과를 확인할 차례입니다.",
                en: "The result is now waiting for team lead review.",
                ja: "結果はいまチームリードの確認待ちです。",
                zh: "结果现在正等待组长确认。",
              })
            : isComplete
              ? t({
                  ko: "실행은 깔끔하게 끝났고, 다음 단계로 넘어갈 준비가 됐습니다.",
                  en: "The run wrapped cleanly and is ready for the next handoff.",
                  ja: "実行はきれいに完了し、次の受け渡しに進める状態です。",
                  zh: "本轮执行已顺利收口，可以进入下一步交接。",
                })
              : message;

      const actorLabel = taskTitle ? `${actorLabelBase} · ${taskTitle}` : actorLabelBase;

      if (isMemory) {
        return {
          id: `activity-${activity.id}`,
          title,
          body,
          actorLabel,
          timestamp: activity.created_at,
          badgeLabel: t({ ko: "MEMORY", en: "MEMORY", ja: "MEMORY", zh: "MEMORY" }),
          badgeClassName: "bg-fuchsia-500/12 text-fuchsia-200 border-fuchsia-400/30",
          leftBorderClassName: "border-l-fuchsia-400",
          dotClassName: "bg-fuchsia-300",
          fallbackIcon: "🧠",
          agent: linkedAgent,
        };
      }

      if (isFailure) {
        return {
          id: `activity-${activity.id}`,
          title,
          body,
          actorLabel,
          timestamp: activity.created_at,
          badgeLabel: t({ ko: "ALERT", en: "ALERT", ja: "ALERT", zh: "ALERT" }),
          badgeClassName: "bg-rose-500/12 text-rose-200 border-rose-400/30",
          leftBorderClassName: "border-l-rose-400",
          dotClassName: "bg-rose-300",
          fallbackIcon: "🚨",
          agent: linkedAgent,
        };
      }

      if (isReview) {
        return {
          id: `activity-${activity.id}`,
          title,
          body,
          actorLabel,
          timestamp: activity.created_at,
          badgeLabel: t({ ko: "REVIEW", en: "REVIEW", ja: "REVIEW", zh: "REVIEW" }),
          badgeClassName: "bg-amber-500/12 text-amber-200 border-amber-400/30",
          leftBorderClassName: "border-l-amber-400",
          dotClassName: "bg-amber-300",
          fallbackIcon: "🪄",
          agent: linkedAgent,
        };
      }

      return {
        id: `activity-${activity.id}`,
        title,
        body,
        actorLabel,
        timestamp: activity.created_at,
        badgeLabel: t({ ko: "DONE", en: "DONE", ja: "DONE", zh: "DONE" }),
        badgeClassName: "bg-emerald-500/12 text-emerald-200 border-emerald-400/30",
        leftBorderClassName: "border-l-emerald-400",
        dotClassName: "bg-emerald-300",
        fallbackIcon: "✨",
        agent: linkedAgent,
      };
    };

    const recentActivity = (stats?.recent_activity ?? []).filter(isDisplayableActivity).slice(0, 8);
    if (recentActivity.length > 0) {
      return recentActivity.map(buildActivityEntry);
    }

    return [...tasks]
      .sort((a, b) => b.updated_at - a.updated_at)
      .slice(0, 6)
      .map((task) => {
        const assignedAgent = task.assigned_agent ?? (task.assigned_agent_id ? agentMap.get(task.assigned_agent_id) : undefined);
        const badgeLabel = taskStatusLabel(task.status, t);
        const statusInfo = STATUS_LABELS[task.status] ?? {
          color: "bg-slate-600/20 text-slate-200 border-slate-500/30",
          dot: "bg-slate-400",
        };
        const leftBorder = STATUS_LEFT_BORDER[task.status] ?? "border-l-slate-500";
        return {
          id: task.id,
          title: task.title,
          body:
            task.status === "done"
              ? t({
                  ko: "하나의 업무가 매듭지어졌습니다.",
                  en: "One mission wrapped up cleanly.",
                  ja: "ひとつの仕事がきれいに締まりました。",
                  zh: "又有一项任务顺利收口。",
                })
              : task.status === "review"
                ? t({
                    ko: "결과를 다듬고 확인하는 마지막 단계입니다.",
                    en: "This one is in the final polish-and-check step.",
                    ja: "仕上げと確認の最終段階にいます。",
                    zh: "这项任务正处在最后的润色与检查阶段。",
                  })
                : t({
                    ko: "조용히 다음 진행을 기다리고 있습니다.",
                    en: "Quietly waiting for the next push forward.",
                    ja: "静かに次の一押しを待っています。",
                    zh: "正安静地等待下一步推进。",
                  }),
          actorLabel: assignedAgent
            ? localeName(language, assignedAgent)
            : t({ ko: "미배정", en: "Unassigned", ja: "未割り当て", zh: "未分配" }),
          timestamp: task.updated_at,
          badgeLabel,
          badgeClassName: statusInfo.color,
          leftBorderClassName: leftBorder,
          dotClassName: statusInfo.dot,
          fallbackIcon: "📄",
          agent: assignedAgent,
        };
      });
  }, [stats, tasks, agentMap, language, t]);

  const podiumOrder =
    topAgents.length >= 3
      ? [topAgents[1], topAgents[0], topAgents[2]]
      : topAgents.length === 2
        ? [topAgents[1], topAgents[0]]
        : topAgents;

  const hudStats: HudStat[] = [
    {
      id: "total",
      label: t({ ko: "미션", en: "MISSIONS", ja: "ミッション", zh: "任务" }),
      value: totalTasks,
      sub: t({ ko: "누적 태스크", en: "Total tasks", ja: "累積タスク", zh: "累计任务" }),
      color: "#3b82f6",
      icon: "📋",
    },
    {
      id: "clear",
      label: t({ ko: "완료율", en: "CLEAR RATE", ja: "クリア率", zh: "完成率" }),
      value: `${completionRate}%`,
      sub: `${numberFormatter.format(completedTasks)} ${t({ ko: "클리어", en: "cleared", ja: "クリア", zh: "完成" })}`,
      color: "#10b981",
      icon: "✅",
    },
    {
      id: "squad",
      label: t({ ko: "스쿼드", en: "SQUAD", ja: "スクワッド", zh: "小队" }),
      value: `${activeAgents}/${totalAgents}`,
      sub: `${t({ ko: "가동률", en: "uptime", ja: "稼働率", zh: "运行率" })} ${activeRate}%`,
      color: "#00f0ff",
      icon: "🤖",
    },
    {
      id: "active",
      label: t({ ko: "진행중", en: "IN PROGRESS", ja: "進行中", zh: "进行中" }),
      value: inProgressTasks,
      sub: `${t({ ko: "계획", en: "planned", ja: "計画", zh: "计划" })} ${numberFormatter.format(plannedTasks)}${t({
        ko: "건",
        en: "",
        ja: "件",
        zh: "项",
      })}`,
      color: "#f59e0b",
      icon: "⚡",
    },
  ];

  return (
    <section className="relative isolate space-y-4" style={{ color: "var(--th-text-primary)" }}>
      <div className="pointer-events-none absolute -left-40 -top-32 h-96 w-96 rounded-full bg-violet-600/10 blur-[100px] animate-drift-slow" />
      <div className="pointer-events-none absolute -right-32 top-20 h-80 w-80 rounded-full bg-cyan-500/10 blur-[100px] animate-drift-slow-rev" />
      <div className="pointer-events-none absolute left-1/3 bottom-32 h-72 w-72 rounded-full bg-amber-500/[0.05] blur-[80px]" />

      <DashboardHeroHeader
        companyName={companyName}
        time={time}
        date={date}
        briefing={briefing}
        reviewQueue={reviewQueue}
        numberFormatter={numberFormatter}
        primaryCtaEyebrow={primaryCtaEyebrow}
        primaryCtaDescription={primaryCtaDescription}
        primaryCtaLabel={primaryCtaLabel}
        onPrimaryCtaClick={onPrimaryCtaClick}
        t={t}
      />

      <DashboardHudStats hudStats={hudStats} numberFormatter={numberFormatter} />

      <DashboardRankingBoard
        topAgents={topAgents}
        podiumOrder={podiumOrder}
        agentMap={agentMap}
        agents={agents}
        maxXp={maxXp}
        numberFormatter={numberFormatter}
        t={t}
      />

      <DashboardDeptAndSquad
        deptData={deptData}
        workingAgents={workingAgents}
        idleAgentsList={idleAgentsList}
        agents={agents}
        language={language}
        numberFormatter={numberFormatter}
        t={t}
      />

      <DashboardMissionLog
        entries={missionLogEntries}
        agents={agents}
        localeTag={localeTag}
        idleAgents={idleAgents}
        numberFormatter={numberFormatter}
        t={t}
      />
    </section>
  );
}
