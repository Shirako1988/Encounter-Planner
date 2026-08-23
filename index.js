
import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';

// =================================================================================
// TYPE DEFINITIONS are stripped for JS compatibility
// =================================================================================

// =================================================================================
// CONSTANTS (from constants.ts)
// =================================================================================

const XP_THRESHOLDS_PER_LEVEL = {
  1: { low: 50, moderate: 75, high: 100 },
  2: { low: 100, moderate: 150, high: 200 },
  3: { low: 150, moderate: 225, high: 400 },
  4: { low: 250, moderate: 375, high: 500 },
  5: { low: 500, moderate: 750, high: 1100 },
  6: { low: 600, moderate: 1000, high: 1400 },
  7: { low: 750, moderate: 1300, high: 1700 },
  8: { low: 1000, moderate: 1700, high: 2100 },
  9: { low: 1300, moderate: 2000, high: 2600 },
  10: { low: 1600, moderate: 2300, high: 3100 },
  11: { low: 1900, moderate: 2900, high: 4100 },
  12: { low: 2200, moderate: 3700, high: 4700 },
  13: { low: 2600, moderate: 4200, high: 5400 },
  14: { low: 2900, moderate: 4900, high: 6200 },
  15: { low: 3300, moderate: 5400, high: 7800 },
  16: { low: 3800, moderate: 6100, high: 9800 },
  17: { low: 4500, moderate: 7200, high: 11700 },
  18: { low: 5000, moderate: 8700, high: 14200 },
  19: { low: 5500, moderate: 10700, high: 17200 },
  20: { low: 6400, moderate: 13200, high: 22000 },
};

const CR_TO_XP = {
  "0": 10,
  "1/8": 25,
  "1/4": 50,
  "1/2": 100,
  "1": 200,
  "2": 450,
  "3": 700,
  "4": 1100,
  "5": 1800,
  "6": 2300,
  "7": 2900,
  "8": 3900,
  "9": 5000,
  "10": 5900,
  "11": 7200,
  "12": 8400,
  "13": 10000,
  "14": 11500,
  "15": 13000,
  "16": 15000,
  "17": 18000,
  "18": 20000,
  "19": 22000,
  "20": 25000,
  "21": 33000,
  "22": 41000,
  "23": 50000,
  "24": 62000,
  "25": 75000,
  "26": 90000,
  "27": 105000,
  "28": 120000,
  "29": 135000,
  "30": 155000
};

const DIFFICULTY_COLORS = {
    trivial: 'bg-slate-500',
    easy: 'bg-sky-600',
    medium: 'bg-green-600',
    hard: 'bg-amber-600',
    deadly: 'bg-red-700',
    unknown: 'bg-slate-700',
};

const DIFFICULTY_TEXT_COLORS = {
    trivial: 'text-slate-400',
    easy: 'text-sky-400',
    medium: 'text-green-400',
    hard: 'text-amber-400',
    deadly: 'text-red-400',
    unknown: 'text-slate-500',
};

// =================================================================================
// SERVICES (from services/xpCalculations.ts)
// =================================================================================

const clampLevel = (level) => Math.max(1, Math.min(20, parseInt(level, 10) || 1));

const createDefaultPlayers = (size = 4, level = 1) => {
  const safeSize = Math.max(1, Math.min(20, parseInt(size, 10) || 4));
  const safeLevel = clampLevel(level);
  return Array.from({ length: safeSize }, (_, index) => ({
    id: crypto.randomUUID(),
    name: `Player ${index + 1}`,
    level: safeLevel,
  }));
};

const getPartyPlayers = (party = {}) => {
  if (Array.isArray(party.players) && party.players.length > 0) {
    return party.players.map((player, index) => ({
      id: player.id || crypto.randomUUID(),
      name: player.name || `Player ${index + 1}`,
      level: clampLevel(player.level),
    }));
  }
  return createDefaultPlayers(party.size || 4, party.level || 1);
};

const getPartyPlayerCount = (party = {}) => getPartyPlayers(party).length;

const getAveragePartyLevel = (party = {}) => {
  const players = getPartyPlayers(party);
  if (players.length === 0) return 1;
  const total = players.reduce((sum, player) => sum + clampLevel(player.level), 0);
  return total / players.length;
};

const getEffectiveBudgetLevel = (party = {}) => {
  if (party.levelOverride !== null && party.levelOverride !== undefined && party.levelOverride !== '') {
    return clampLevel(party.levelOverride);
  }
  return clampLevel(Math.round(getAveragePartyLevel(party)));
};

const getXpShares = (party = {}) => {
  const hirelings = Math.max(0, parseInt(party.hirelings, 10) || 0);
  return Math.max(1, getPartyPlayerCount(party) + hirelings);
};

// Easy / Medium / Hard are the official 2024 encounter-planning values.
// Trivial and Deadly are extrapolated one equal category-step outward:
//   Trivial = 2 * Easy - Medium
//   Deadly  = 2 * Hard - Medium
// If Trivial would become zero or negative (currently only possible at level 20
// with the default matrix), fall back to 50% of Easy.
const buildEncounterThresholds = (easyValue, mediumValue, hardValue) => {
  const easy = Math.max(0, Math.round(easyValue));
  const medium = Math.max(0, Math.round(mediumValue));
  const hard = Math.max(0, Math.round(hardValue));

  const extrapolatedTrivial = (2 * easy) - medium;
  const trivial = extrapolatedTrivial > 0
    ? extrapolatedTrivial
    : Math.round(easy * 0.5);

  const deadly = (2 * hard) - medium;

  return { trivial, easy, medium, hard, deadly };
};

const calculateEncounterThresholds = (party, multiplier, xpTable) => {
  const players = getPartyPlayers(party);
  const mode = party?.budgetMode || 'average';
  const safeMultiplier = multiplier ?? 1;

  if (mode === 'sum') {
    const summed = players.reduce((totals, player) => {
      const t = xpTable[clampLevel(player.level)];
      if (!t) return totals;
      return {
        low: totals.low + t.low,
        moderate: totals.moderate + t.moderate,
        high: totals.high + t.high,
      };
    }, { low: 0, moderate: 0, high: 0 });

    return buildEncounterThresholds(
      summed.low * safeMultiplier,
      summed.moderate * safeMultiplier,
      summed.high * safeMultiplier
    );
  }

  const effectiveLevel = getEffectiveBudgetLevel(party);
  const t = xpTable[effectiveLevel];
  const playerCount = players.length;
  if (!t || playerCount < 1) return { trivial: 0, easy: 0, medium: 0, hard: 0, deadly: 0 };

  return buildEncounterThresholds(
    t.low * playerCount * safeMultiplier,
    t.moderate * playerCount * safeMultiplier,
    t.high * playerCount * safeMultiplier
  );
};

const calculateDailyBudget = (party, multiplier, xpTable) => {
  const players = getPartyPlayers(party);
  const mode = party?.budgetMode || 'average';
  const safeMultiplier = multiplier ?? 1;

  if (mode === 'sum') {
    const highTotal = players.reduce((sum, player) => sum + (xpTable[clampLevel(player.level)]?.high || 0), 0);
    return Math.round(highTotal * 3 * safeMultiplier);
  }

  const highXP = xpTable[getEffectiveBudgetLevel(party)]?.high || 0;
  return Math.round(players.length * highXP * 3 * safeMultiplier);
};

const calculateAdjustedXp = (baseXp, count, overhangPercent) => {
  if (!baseXp || !count || count < 1) return 0;
  if (count >= 2) {
    const excess = count - 1; // Bonus applies from the second creature
    const bonus = baseXp * excess * (overhangPercent / 100);
    return Math.round(baseXp + bonus);
  }
  return baseXp;
};

const calculatePlayerXpAward = (baseXp, xpShares, awardPercent) => {
  const safeShares = Math.max(1, xpShares || 1);
  const safeAwardPercent = awardPercent ?? 50;
  return Math.round((baseXp * (safeAwardPercent / 100)) / safeShares);
};

const getSuggestedBudgetMultiplier = (level) => {
  const safeLevel = Math.max(1, Math.min(20, parseInt(level, 10) || 1));
  if (safeLevel === 1) return 0.5;
  if (safeLevel === 2) return 0.75;
  return 1.0;
};

const getSuggestedXpAwardPercent = (level) => {
  const safeLevel = Math.max(1, Math.min(20, parseInt(level, 10) || 1));
  if (safeLevel <= 2) return 100;
  if (safeLevel <= 4) return 90;
  if (safeLevel <= 6) return 80;
  if (safeLevel <= 9) return 70;
  if (safeLevel <= 12) return 60;
  return 50;
};

const getEffectiveBudgetMultiplier = (settings, level) => {
  if ((settings?.budgetMultiplierMode || 'manual') === 'auto') {
    return getSuggestedBudgetMultiplier(level);
  }
  return settings?.budgetMultiplier ?? 1.0;
};

const getEffectiveXpAwardPercent = (settings, level) => {
  if ((settings?.xpAwardMode || 'manual') === 'auto') {
    return getSuggestedXpAwardPercent(level);
  }
  return settings?.xpAwardPercent ?? 50;
};

const getDifficultyBoundaries = (thresholds) => ({
  trivialEasy: (thresholds.trivial + thresholds.easy) / 2, // 20%
  easyMedium: (thresholds.easy + thresholds.medium) / 2,   // 40%
  mediumHard: (thresholds.medium + thresholds.hard) / 2,   // 60%
  hardDeadly: (thresholds.hard + thresholds.deadly) / 2,   // 80%
});

const getEncounterDifficulty = (adjustedXp, thresholds) => {
  if (thresholds.deadly === 0) return { level: 'unknown', percentage: 0 };

  // The five threshold values are MIDPOINTS of five equal-width bar sections:
  // Trivial = 10%, Easy = 30%, Medium = 50%, Hard = 70%, Deadly = 90%.
  // Interpolating directly between these anchors guarantees that every displayed
  // threshold lands exactly in the middle of its corresponding bar section.
  const boundaries = getDifficultyBoundaries(thresholds);
  const maxDeadlyXp = thresholds.deadly + ((thresholds.deadly - thresholds.hard) / 2);

  const anchors = [
    { xp: 0,                  percentage: 0 },
    { xp: thresholds.trivial, percentage: 10 },
    { xp: thresholds.easy,    percentage: 30 },
    { xp: thresholds.medium,  percentage: 50 },
    { xp: thresholds.hard,    percentage: 70 },
    { xp: thresholds.deadly,  percentage: 90 },
    { xp: maxDeadlyXp,        percentage: 100 },
  ];

  const interpolate = (xp, start, end) => {
    const range = end.xp - start.xp;
    if (range <= 0) return start.percentage;
    const progress = (xp - start.xp) / range;
    return start.percentage + progress * (end.percentage - start.percentage);
  };

  let percentage = adjustedXp <= 0 ? 0 : 100;

  if (adjustedXp > 0) {
    for (let i = 0; i < anchors.length - 1; i++) {
      const start = anchors[i];
      const end = anchors[i + 1];
      if (adjustedXp <= end.xp) {
        percentage = interpolate(adjustedXp, start, end);
        break;
      }
    }
  }

  let level;
  if (adjustedXp < boundaries.trivialEasy) {
    level = 'trivial';
  } else if (adjustedXp < boundaries.easyMedium) {
    level = 'easy';
  } else if (adjustedXp < boundaries.mediumHard) {
    level = 'medium';
  } else if (adjustedXp < boundaries.hardDeadly) {
    level = 'hard';
  } else {
    level = 'deadly';
  }

  return {
    level,
    percentage: Math.max(0, Math.min(100, percentage)),
  };
};

// =================================================================================
// HOOKS (from hooks/useUndoRedo.ts)
// =================================================================================

const useUndoRedo = (initialState) => {
  const [history, setHistory] = useState({
    past: [],
    present: initialState,
    future: [],
  });

  const { past, present, future } = history;
  const canUndo = past.length > 0;
  const canRedo = future.length > 0;

  const setState = useCallback((newState, fromHistory = false) => {
    if (fromHistory) {
      // When loading a new state from history or a save file, we reset the undo/redo history.
      setHistory({
        past: [],
        present: newState,
        future: [],
      });
      return;
    }

    setHistory(currentHistory => {
      // Don't add to history if state is identical
      if (JSON.stringify(newState) === JSON.stringify(currentHistory.present)) {
        return currentHistory;
      }
      return {
        past: [...currentHistory.past, currentHistory.present],
        present: newState,
        future: [],
      };
    });
  }, []);

  const undo = useCallback(() => {
    if (!canUndo) return;
    const previous = past[past.length - 1];
    const newPast = past.slice(0, past.length - 1);
    setHistory({
      past: newPast,
      present: previous,
      future: [present, ...future],
    });
  }, [canUndo, past, present, future]);

  const redo = useCallback(() => {
    if (!canRedo) return;
    const next = future[0];
    const newFuture = future.slice(1);
    setHistory({
      past: [...past, present],
      present: next,
      future: newFuture,
    });
  }, [canRedo, past, present, future]);

  return [present, setState, undo, redo, canUndo, canRedo];
};


// =================================================================================
// SHARED UI COMPONENTS
// =================================================================================

const NumberInput = ({ isEncounter = false, ...props }) => (
  React.createElement('input', {
    type: "number",
    className: `w-full bg-[#eee3cf] dark:bg-[#2f2f2f] text-[#4a2e1a] dark:text-[#d4c8b0] border-2 border-[#d1c7b8] dark:border-[#4a4a4a] text-base focus:outline-none focus:border-[#c99a4e] transition ${isEncounter ? 'px-2 py-1.5 rounded' : 'px-3 py-2 rounded'}`,
    ...props
  })
);

const FormGroup = ({ label, title, children, isEncounter = false }) => (
    React.createElement('div', { className: isEncounter ? "flex-1 min-w-[60px]" : "flex-1" },
      React.createElement('label', { className: `block font-bold text-[#6d4f33] dark:text-[#a38b6d] ${isEncounter ? 'text-sm mb-1' : 'text-base mb-2'}`, title: title }, label),
      children
    )
);

const Panel = ({ children, className = '' }) => (
  React.createElement('div', { className: `bg-[#f3eadd] border-2 border-[#d1c7b8] dark:bg-[#2a2a2a] dark:border-[#4a4a4a] p-5 rounded-none shadow-md ${className}` }, children)
);

const FormRow = ({ children }) => (
  React.createElement('div', { className: "flex gap-3 items-end" }, children)
);

const GlobalUiStyles = () => React.createElement('style', null, `
  .custom-scrollbar {
    scrollbar-width: thin;
    scrollbar-color: rgba(201, 154, 78, 0.68) rgba(209, 199, 184, 0.30);
    scrollbar-gutter: stable;
  }

  .dark .custom-scrollbar {
    scrollbar-color: rgba(201, 154, 78, 0.78) rgba(74, 74, 74, 0.55);
  }

  .custom-scrollbar::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }

  .custom-scrollbar::-webkit-scrollbar-track {
    background: rgba(209, 199, 184, 0.30);
    border-radius: 999px;
  }

  .dark .custom-scrollbar::-webkit-scrollbar-track {
    background: rgba(74, 74, 74, 0.55);
  }

  .custom-scrollbar::-webkit-scrollbar-thumb {
    background: rgba(201, 154, 78, 0.68);
    border: 2px solid rgba(243, 234, 221, 0.95);
    border-radius: 999px;
  }

  .dark .custom-scrollbar::-webkit-scrollbar-thumb {
    background: rgba(201, 154, 78, 0.78);
    border-color: rgba(42, 42, 42, 0.95);
  }

  .custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background: rgba(201, 154, 78, 0.95);
  }

  .custom-scrollbar::-webkit-scrollbar-corner {
    background: transparent;
  }
`);

const RangeInput = (props) => (
  React.createElement('input', {
    type: "range",
    className: "w-full h-2 bg-[#d1c7b8] dark:bg-[#4a4a4a] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#c99a4e]",
    ...props
  })
);

const RangeInputWithGhost = ({ suggestedValue, min, max, ...props }) => {
  const minNumber = parseFloat(min);
  const maxNumber = parseFloat(max);
  const suggestedNumber = parseFloat(suggestedValue);
  const hasValidMarker = Number.isFinite(minNumber) && Number.isFinite(maxNumber) && Number.isFinite(suggestedNumber) && maxNumber > minNumber;
  const clampedSuggested = hasValidMarker ? Math.max(minNumber, Math.min(maxNumber, suggestedNumber)) : minNumber;
  const markerPercent = hasValidMarker ? ((clampedSuggested - minNumber) / (maxNumber - minNumber)) * 100 : 0;
  const thumbWidthPx = 20;
  const markerOffsetPx = hasValidMarker ? (thumbWidthPx / 2) - (thumbWidthPx * markerPercent / 100) : 0;

  return React.createElement('div', { className: "relative flex-1 flex items-center h-6" },
    hasValidMarker && React.createElement('div', {
      className: "absolute top-1/2 w-5 h-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#c99a4e]/70 bg-[#c99a4e]/20 pointer-events-none z-10 shadow-sm",
      style: { left: `calc(${markerPercent}% + ${markerOffsetPx}px)` },
      title: `Suggested: ${suggestedValue}`
    }),
    React.createElement(RangeInput, { min, max, ...props })
  );
};

const DragHandleIcon = () => (
    React.createElement('svg', { xmlns: "http://www.w3.org/2000/svg", width: "20", height: "20", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" },
        React.createElement('circle', { cx: "9", cy: "12", r: "1" }),
        React.createElement('circle', { cx: "9", cy: "5", r: "1" }),
        React.createElement('circle', { cx: "9", cy: "19", r: "1" }),
        React.createElement('circle', { cx: "15", cy: "12", r: "1" }),
        React.createElement('circle', { cx: "15", cy: "5", r: "1" }),
        React.createElement('circle', { cx: "15", cy: "19", r: "1" })
    )
);

const CloseIcon = ({ size = 18 }) => (
    React.createElement('svg', {
      xmlns: "http://www.w3.org/2000/svg",
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "2.5",
      strokeLinecap: "round",
      'aria-hidden': "true",
      focusable: "false"
    },
      React.createElement('path', { d: "M6 6l12 12" }),
      React.createElement('path', { d: "M18 6L6 18" })
    )
);

const DifficultyLegendLabel = ({ colorClass, text, className = '' }) => (
    React.createElement('span', { className: `inline-flex items-center gap-1 ${className}` },
      React.createElement('span', { className: `inline-block h-2.5 w-2.5 ${colorClass}`, 'aria-hidden': "true" }),
      text
    )
);

const UndoIcon = () => ( React.createElement('svg', { xmlns: "http://www.w3.org/2000/svg", width: "16", height: "16", fill: "currentColor", viewBox: "0 0 16 16" }, React.createElement('path', { fillRule: "evenodd", d: "M8 3a5 5 0 1 1-4.546 2.914.5.5 0 0 0-.908-.417A6 6 0 1 0 8 2z" }), React.createElement('path', { d: "M8 4.466V.534a.25.25 0 0 0-.41-.192L5.23 2.308a.25.25 0 0 0 0 .384l2.36 1.966A.25.25 0 0 0 8 4.466" })) );
const RedoIcon = () => ( React.createElement('svg', { xmlns: "http://www.w3.org/2000/svg", width: "16", height: "16", fill: "currentColor", viewBox: "0 0 16 16" }, React.createElement('path', { fillRule: "evenodd", d: "M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2z" }), React.createElement('path', { d: "M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966a.25.25 0 0 1 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466" })) );
const SunIcon = () => ( React.createElement('svg', { xmlns: "http://www.w3.org/2000/svg", width: "16", height: "16", fill: "currentColor", viewBox: "0 0 16 16" }, React.createElement('path', { d: "M8 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6m0 1a4 4 0 1 0 0-8 4 4 0 0 0 0 8M8 0a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 0m0 13a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 13m-5-4a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 0 1h-2a.5.5 0 0 1-.5-.5M11 .5a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2a.5.5 0 0 1 .5-.5m-2.657 1.621a.5.5 0 0 1 .707 0l1.414 1.414a.5.5 0 0 1-.707.707L8.343 2.828a.5.5 0 0 1 0-.707m-4.95 4.95a.5.5 0 0 1 0 .707L2.828 8.343a.5.5 0 0 1-.707-.707l1.414-1.414a.5.5 0 0 1 .707 0zm4.95 4.95a.5.5 0 0 1 .707 0l1.414 1.414a.5.5 0 0 1-.707.707l-1.414-1.414a.5.5 0 0 1 0-.707M1.621 11.657a.5.5 0 0 1 0 .707l1.414 1.414a.5.5 0 0 1-.707.707l-1.414-1.414a.5.5 0 0 1 .707-.707M13 8a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 0 1h-2A.5.5 0 0 1 13 8" })) );
const MoonIcon = () => ( React.createElement('svg', { xmlns: "http://www.w3.org/2000/svg", width: "16", height: "16", fill: "currentColor", viewBox: "0 0 16 16" }, React.createElement('path', { d: "M6 .278a.77.77 0 0 1 .08.858 7.2 7.2 0 0 0-1.023 7.925 7.2 7.2 0 0 0 7.925-1.023.77.77 0 0 1 .858.08.77.77 0 0 1 .387.653A6.5 6.5 0 0 1 9.5 16 6.5 6.5 0 0 1 3 9.5a6.5 6.5 0 0 1 2.625-5.053.77.77 0 0 1 .653.387z" })) );
const SystemIcon = () => ( React.createElement('svg', { xmlns: "http://www.w3.org/2000/svg", width: "16", height: "16", fill: "currentColor", viewBox: "0 0 16 16" }, React.createElement('path', { d: "M12 1.5a.5.5 0 0 1 .5.5v11a.5.5 0 0 1-1 0v-11a.5.5 0 0 1 .5-.5M3.5 1a.5.5 0 0 0-.5.5v13a.5.5 0 0 0 1 0V1.5a.5.5 0 0 0-.5-.5M1.5 4a.5.5 0 0 0-.5.5v8a.5.5 0 0 0 1 0v-8a.5.5 0 0 0-.5-.5m13 0a.5.5 0 0 0-.5.5v8a.5.5 0 0 0 1 0v-8a.5.5 0 0 0-.5-.5M7 14a1 1 0 1 0 0-2 1 1 0 0 0 0 2" })) );
const SaveIcon = () => ( React.createElement('svg', { xmlns: "http://www.w3.org/2000/svg", width: "16", height: "16", fill: "currentColor", viewBox: "0 0 16 16" }, React.createElement('path', { d: "M2 1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H9.5a1 1 0 0 0-1 1v4.5h2a.5.5 0 0 1 .354.854l-2.5 2.5a.5.5 0 0 1-.708 0l-2.5-2.5A.5.5 0 0 1 5.5 6.5h2V2a2 2 0 0 1 2-2H14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h2.5a.5.5 0 0 1 0 1z" })) );


// =================================================================================
// COMPONENTS (from components folder)
// =================================================================================

// --- ConfirmDeleteModal (New Component) ---
const ConfirmDeleteModal = ({ isOpen, onClose, onConfirm, slotName }) => {
    if (!isOpen) return null;

    return (
        React.createElement('div', { className: "fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4", onClick: onClose },
            React.createElement('div', { className: "bg-[#f3eadd] dark:bg-[#2a2a2a] border-4 border-[#d1c7b8] dark:border-[#4a4a4a] w-full max-w-md flex flex-col shadow-2xl", onClick: e => e.stopPropagation() },
                React.createElement('header', { className: "flex justify-between items-center p-4 border-b-4 border-red-800/40" },
                    React.createElement('h2', { className: "text-2xl font-bold font-medieval text-red-800 dark:text-red-500" }, "Confirm Delete"),
                    React.createElement('button', { onClick: onClose, className: "text-[#6d4f33] dark:text-[#a38b6d] hover:text-red-700", title: "Close", 'aria-label': "Close" }, React.createElement(CloseIcon, { size: 24 }))
                ),
                React.createElement('div', { className: "p-6 text-center" },
                    React.createElement('p', { className: "text-lg text-[#6d4f33] dark:text-[#d4c8b0]" },
                        "Are you sure you want to permanently delete the save slot ",
                        React.createElement('br'),
                        React.createElement('strong', { className: "font-bold text-[#c99a4e]" }, slotName), "?"
                    ),
                    React.createElement('p', { className: "text-sm text-slate-500 mt-2" }, "This action cannot be undone.")
                ),
                React.createElement('footer', { className: "flex justify-end gap-3 p-4 bg-[#eee3cf] dark:bg-[#2f2f2f]" },
                    React.createElement('button', { onClick: onClose, className: "bg-transparent border-2 border-slate-500 text-slate-600 dark:text-slate-400 font-bold py-2 px-6 rounded-sm transition-colors hover:bg-slate-500/20" },
                        "Cancel"
                    ),
                    React.createElement('button', { onClick: onConfirm, className: "bg-red-800 text-white font-bold py-2 px-6 rounded-sm transition-transform hover:scale-105 border-2 border-red-900" },
                        "Delete"
                    )
                )
            )
        )
    );
};

const ConfirmDeleteDayModal = ({ isOpen, onClose, onConfirm, day }) => {
    if (!isOpen || !day) return null;

    const encounterCount = Array.isArray(day.encounters) ? day.encounters.length : 0;

    return (
        React.createElement('div', { className: "fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4", onClick: onClose },
            React.createElement('div', { className: "bg-[#f3eadd] dark:bg-[#2a2a2a] border-4 border-[#d1c7b8] dark:border-[#4a4a4a] w-full max-w-md flex flex-col shadow-2xl", onClick: e => e.stopPropagation() },
                React.createElement('header', { className: "flex justify-between items-center p-4 border-b-4 border-red-800/40" },
                    React.createElement('h2', { className: "text-2xl font-bold font-medieval text-red-800 dark:text-red-500" }, "Confirm Delete Day"),
                    React.createElement('button', { onClick: onClose, className: "text-[#6d4f33] dark:text-[#a38b6d] hover:text-red-700", title: "Close", 'aria-label': "Close" }, React.createElement(CloseIcon, { size: 24 }))
                ),
                React.createElement('div', { className: "p-6 text-center" },
                    React.createElement('p', { className: "text-lg text-[#6d4f33] dark:text-[#d4c8b0]" },
                        "Are you sure you want to delete this Adventuring Day?",
                        React.createElement('br'),
                        React.createElement('strong', { className: "font-bold text-[#c99a4e]" }, day.title || "Unnamed Day")
                    ),
                    React.createElement('p', { className: "text-sm text-slate-500 mt-2" },
                        `${encounterCount} encounter${encounterCount === 1 ? '' : 's'} will also be deleted. This action cannot be undone.`
                    )
                ),
                React.createElement('footer', { className: "flex justify-end gap-3 p-4 bg-[#eee3cf] dark:bg-[#2f2f2f]" },
                    React.createElement('button', { onClick: onClose, className: "bg-transparent border-2 border-slate-500 text-slate-600 dark:text-slate-400 font-bold py-2 px-6 rounded-sm transition-colors hover:bg-slate-500/20" },
                        "Cancel"
                    ),
                    React.createElement('button', { onClick: onConfirm, className: "bg-red-800 text-white font-bold py-2 px-6 rounded-sm transition-transform hover:scale-105 border-2 border-red-900" },
                        "Delete Day"
                    )
                )
            )
        )
    );
};

// --- SaveManagerModal ---
const SaveManagerModal = ({ isOpen, onClose, saveData, onLoad, onSaveNew, onDelete, onRename, onCopy, onExport, onImport, renamingId, setRenamingId }) => {
    const [newName, setNewName] = useState("");
    const importInputRef = useRef(null);

    useEffect(() => {
        if (renamingId) {
            const slotToRename = saveData.saveSlots.find(s => s.id === renamingId);
            if (slotToRename) {
                setNewName(slotToRename.name);
            }
        }
    }, [renamingId, saveData.saveSlots]);

    if (!isOpen) return null;

    const handleRename = (slot) => {
        setRenamingId(slot.id);
        setNewName(slot.name);
    };
    
    const handleRenameSubmit = (slotId) => {
        if (newName.trim()) {
            onRename(slotId, newName.trim());
        }
        setRenamingId(null);
    };
    
    const handleImportClick = () => {
        importInputRef.current?.click();
    };

    const handleFileImport = (e) => {
        const file = e.target.files?.[0];
        if (file) {
            onImport(file);
        }
        e.target.value = ''; // Reset for re-importing same file
    };

    return (
        React.createElement('div', { className: "fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4", onClick: onClose },
            React.createElement('div', { className: "bg-[#f3eadd] dark:bg-[#2a2a2a] border-4 border-[#d1c7b8] dark:border-[#4a4a4a] w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl", onClick: e => e.stopPropagation() },
                React.createElement('header', { className: "flex justify-between items-center p-4 border-b-4 border-[#c99a4e]/40" },
                    React.createElement('h2', { className: "text-2xl font-bold font-medieval text-[#c99a4e]" }, "Manage Saves"),
                    React.createElement('button', { onClick: onClose, className: "text-[#6d4f33] dark:text-[#a38b6d] hover:text-[#c99a4e]", title: "Close", 'aria-label': "Close" }, React.createElement(CloseIcon, { size: 24 }))
                ),

                React.createElement('div', { className: "p-4 overflow-y-auto custom-scrollbar" },
                    React.createElement('div', { className: "grid grid-cols-2 gap-3 mb-4" },
                        React.createElement('button', { onClick: onSaveNew, className: "w-full bg-transparent border-2 border-[#c99a4e]/50 text-[#c99a4e] font-bold py-2.5 px-4 rounded-sm transition-colors hover:bg-[#c99a4e]/20" },
                            "+ Neuer Speicherstand"
                        ),
                        React.createElement('button', { onClick: handleImportClick, className: "w-full bg-transparent border-2 border-[#c99a4e]/50 text-[#c99a4e] font-bold py-2.5 px-4 rounded-sm transition-colors hover:bg-[#c99a4e]/20" },
                            "Importieren..."
                        ),
                        React.createElement('input', { type: "file", accept: ".json", ref: importInputRef, onChange: handleFileImport, className: "hidden" })
                    ),

                    React.createElement('div', { className: "space-y-2" },
                        saveData.saveSlots.map(slot => (
                            React.createElement('div', { key: slot.id, className: `p-3 flex flex-col sm:flex-row sm:items-center gap-3 border-2 ${slot.id === saveData.activeSlotId ? 'bg-[#c99a4e]/20 border-[#c99a4e]' : 'bg-[#eee3cf] dark:bg-[#2f2f2f] border-[#d1c7b8] dark:border-[#4a4a4a]'}` },
                                React.createElement('div', { className: "flex-1" },
                                    renamingId === slot.id ? (
                                        React.createElement('input', {
                                            type: "text",
                                            value: newName,
                                            onChange: e => setNewName(e.target.value),
                                            onBlur: () => handleRenameSubmit(slot.id),
                                            onKeyDown: e => e.key === 'Enter' && handleRenameSubmit(slot.id),
                                            className: "bg-[#f3eadd] dark:bg-[#1a1a1a] px-2 py-1 border-2 border-[#c99a4e] w-full",
                                            autoFocus: true
                                        })
                                    ) : (
                                        React.createElement('h3', { className: "font-bold text-lg text-[#6d4f33] dark:text-[#d4c8b0]" }, slot.name)
                                    ),
                                    React.createElement('p', { className: "text-xs text-slate-500 dark:text-slate-400" },
                                        `Last modified: ${new Date(slot.lastModified).toLocaleString()}`
                                    )
                                ),
                                React.createElement('div', { className: "flex flex-wrap gap-1.5 justify-start sm:justify-end" },
                                    React.createElement('button', { onClick: () => onLoad(slot.id), disabled: slot.id === saveData.activeSlotId, className: "bg-green-700 text-white px-2 py-1 text-xs font-bold rounded-sm disabled:bg-slate-500 disabled:cursor-not-allowed" }, "Laden"),
                                    React.createElement('button', { onClick: () => handleRename(slot), className: "bg-sky-700 text-white px-2 py-1 text-xs font-bold rounded-sm" }, "Umbenennen"),
                                    React.createElement('button', { onClick: () => onCopy(slot.id), className: "bg-blue-700 text-white px-2 py-1 text-xs font-bold rounded-sm" }, "Kopieren"),
                                    React.createElement('button', { onClick: () => onExport(slot.id), className: "bg-amber-600 text-white px-2 py-1 text-xs font-bold rounded-sm" }, "Export"),
                                    React.createElement('button', { onClick: () => onDelete(slot.id), className: "bg-red-800 text-white px-2 py-1 text-xs font-bold rounded-sm" }, "Delete")
                                )
                            )
                        ))
                    )
                )
            )
        )
    );
};


// --- ThemeSwitcher ---
const ThemeSwitcher = ({ theme, setTheme }) => {
  const options = [
    { value: 'auto', icon: React.createElement(SystemIcon) },
    { value: 'light', icon: React.createElement(SunIcon) },
    { value: 'dark', icon: React.createElement(MoonIcon) },
  ];
  return (
    React.createElement('div', { className: "flex bg-[#d1c7b8] dark:bg-[#4a4a4a] rounded-md p-0.5 border-2 border-[#b8ab98] dark:border-[#5a5a5a]" },
      options.map(opt => (
        React.createElement('button', {
          key: opt.value,
          onClick: () => setTheme(opt.value),
          title: `Set theme to ${opt.value}`,
          className: `px-2 py-1 rounded-sm transition-colors text-lg ${
            theme === opt.value
              ? 'bg-[#f3eadd] dark:bg-[#2a2a2a] text-[#c99a4e]'
              : 'text-[#6d4f33] dark:text-[#a38b6d] hover:bg-white/50 dark:hover:bg-black/20'
          }`
        }, opt.icon)
      ))
    )
  );
};

// --- XpMatrix ---
const XpMatrix = ({ level, xpTable, onUpdate, onReset }) => {
  const currentLevelThresholds = xpTable[level] || { low: 0, moderate: 0, high: 0 };

  const handleUpdate = (key, value) => {
    onUpdate(level, key, parseInt(value) || 0);
  };

  return (
    React.createElement(Panel, null,
      React.createElement('div', { className: "flex justify-between items-center mb-3" },
        React.createElement('h4', { className: "m-0 text-xl font-bold text-[#c99a4e] font-medieval" }, "XP Matrix"),
        React.createElement('button', { 
          onClick: () => onReset(level),
          className: "bg-transparent border-2 border-[#c99a4e]/50 text-[#c99a4e] text-xs font-bold py-1 px-2.5 rounded transition-colors hover:bg-[#c99a4e]/20"
        }, `Reset Level ${level}`)
      ),
      React.createElement('div', { className: "space-y-2 text-base" },
        React.createElement(FormRow, null,
          React.createElement('div', { className: "w-24 shrink-0 font-bold text-[#6d4f33] dark:text-[#a38b6d]" }, "Easy"),
          React.createElement(NumberInput, { 
            value: currentLevelThresholds.low, 
            onChange: e => handleUpdate('low', e.target.value)
          })
        ),
        React.createElement(FormRow, null,
          React.createElement('div', { className: "w-24 shrink-0 font-bold text-[#6d4f33] dark:text-[#a38b6d]" }, "Medium"),
          React.createElement(NumberInput, { 
            value: currentLevelThresholds.moderate, 
            onChange: e => handleUpdate('moderate', e.target.value)
          })
        ),
        React.createElement(FormRow, null,
          React.createElement('div', { className: "w-24 shrink-0 font-bold text-[#6d4f33] dark:text-[#a38b6d]" }, "Hard"),
          React.createElement(NumberInput, { 
            value: currentLevelThresholds.high, 
            onChange: e => handleUpdate('high', e.target.value)
          })
        )
      )
    )
  );
};


// --- EncounterCard.tsx ---
const EncounterCard = ({
  encounter,
  globalOverhangPercent,
  minOverhangPercent,
  xpAwardPercent,
  xpShares,
  encounterThresholds,
  onUpdate,
  onDelete,
  isDragging,
  isDropTargetBefore,
  isDropTargetAfter,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}) => {
  const creatures = encounter.creatures || [];
  
  const suggestedOverhang = useMemo(() => {
    if (creatures.length === 0) return globalOverhangPercent;
    let totalXp = 0;
    let maxXp = 0;
    let totalCount = 0;
    creatures.forEach(c => {
      const xp = CR_TO_XP[c.cr] || 0;
      totalXp += xp * c.count;
      totalCount += c.count;
      if (xp > maxXp) maxXp = xp;
    });
    if (maxXp === 0 || totalCount === 0) return globalOverhangPercent;
    
    const averageXp = totalXp / totalCount;
    const ratio = Math.sqrt(averageXp / maxXp);
    
    const minO = minOverhangPercent || 0;
    const maxO = globalOverhangPercent || 0;
    
    return Math.round(minO + ratio * (maxO - minO));
  }, [creatures, globalOverhangPercent, minOverhangPercent]);

  const overhangPercent = encounter.localOverhangPercent ?? suggestedOverhang;
  
  const derivedBaseXp = useMemo(() => {
    if (creatures.length === 0) return encounter.baseXp;
    return creatures.reduce((sum, c) => sum + (CR_TO_XP[c.cr] || 0) * c.count, 0);
  }, [creatures, encounter.baseXp]);

  const derivedCount = useMemo(() => {
    if (creatures.length === 0) return encounter.count;
    return creatures.reduce((sum, c) => sum + c.count, 0);
  }, [creatures, encounter.count]);
  
  const adjustedXp = useMemo(() => 
    calculateAdjustedXp(derivedBaseXp, derivedCount, overhangPercent),
    [derivedBaseXp, derivedCount, overhangPercent]
  );
  
  const difficulty = useMemo(() =>
    getEncounterDifficulty(adjustedXp, encounterThresholds),
    [adjustedXp, encounterThresholds]
  );

  const playerXpAward = useMemo(() =>
    calculatePlayerXpAward(derivedBaseXp, xpShares, xpAwardPercent),
    [derivedBaseXp, xpShares, xpAwardPercent]
  );

  const [creatureToDelete, setCreatureToDelete] = useState(null);

  const addCreature = () => {
    const newCreatures = [...creatures, { id: crypto.randomUUID(), cr: "1", count: 1 }];
    onUpdate({ creatures: newCreatures });
  };

  const updateCreature = (id, updates) => {
    const newCreatures = creatures.map(c => c.id === id ? { ...c, ...updates } : c);
    onUpdate({ creatures: newCreatures });
  };

  const confirmDeleteCreature = (id) => {
    setCreatureToDelete(id);
  };

  const deleteCreature = () => {
    if (!creatureToDelete) return;
    const newCreatures = creatures.filter(c => c.id !== creatureToDelete);
    onUpdate({ creatures: newCreatures });
    setCreatureToDelete(null);
  };

  return (
    React.createElement('div', {
      onDragOver: onDragOver,
      onDragLeave: onDragLeave,
      onDrop: onDrop,
      onDragEnd: onDragEnd,
      className: `relative bg-[#eee3cf] dark:bg-[#2f2f2f] border-2 border-[#d1c7b8] dark:border-[#4a4a4a] p-3 flex flex-col gap-2 transition-all duration-300 ${isDragging ? 'opacity-50 scale-105 shadow-lg shadow-[#c99a4e]/50' : 'opacity-100'}`
    },
      isDropTargetBefore && React.createElement('div', { className: "absolute top-0 bottom-0 -left-1 w-1 bg-sky-500 rounded-full z-10 pointer-events-none" }),
      isDropTargetAfter && React.createElement('div', { className: "absolute top-0 bottom-0 -right-1 w-1 bg-sky-500 rounded-full z-10 pointer-events-none" }),

      React.createElement('div', {
          draggable: true,
          onDragStart: onDragStart,
          className: "absolute top-2 left-1.5 p-1 cursor-grab text-[#6d4f33] dark:text-[#a38b6d] hover:text-[#c99a4e] hover:bg-[#c99a4e]/10 rounded hidden sm:block",
          title: "Drag to reorder"
      },
          React.createElement(DragHandleIcon)
      ),

      React.createElement('header', { className: "flex justify-between items-center gap-2 sm:ml-8" },
        React.createElement('input', {
          type: "text",
          value: encounter.name,
          onChange: e => onUpdate({ name: e.target.value }),
          className: "bg-transparent border-b-2 border-[#d1c7b8] dark:border-[#4a4a4a] px-2 py-1.5 text-lg font-bold w-full focus:outline-none focus:border-[#c99a4e]",
          placeholder: "Encounter Name"
        }),
        React.createElement('button', { onClick: onDelete, className: "bg-transparent border-2 border-red-800/50 text-red-700 dark:text-red-500 py-1 px-2.5 rounded-sm shrink-0 transition-colors hover:bg-red-800/20", title: "Delete encounter", 'aria-label': "Delete encounter" }, React.createElement(CloseIcon, { size: 16 }))
      ),
      
      React.createElement('div', { className: "flex flex-col gap-2 sm:ml-8" },
        creatures.length > 0 && React.createElement('div', { className: "flex flex-col gap-2 bg-[#d1c7b8]/30 dark:bg-[#1a1a1a]/30 p-2 rounded" },
          creatures.map(c => (
            React.createElement('div', { key: c.id, className: "flex flex-col sm:flex-row items-start sm:items-center gap-2" },
              React.createElement('input', {
                type: "text",
                value: c.name || '',
                onChange: e => updateCreature(c.id, { name: e.target.value }),
                placeholder: "Creature Name",
                className: "flex-1 w-full bg-[#eee3cf] dark:bg-[#2f2f2f] text-[#4a2e1a] dark:text-[#d4c8b0] border-2 border-[#d1c7b8] dark:border-[#4a4a4a] px-2 py-1.5 rounded focus:outline-none focus:border-[#c99a4e]"
              }),
              React.createElement('div', { className: "flex items-center gap-2 w-full sm:w-auto shrink-0" },
                React.createElement('select', {
                  value: c.cr,
                  onChange: e => updateCreature(c.id, { cr: e.target.value }),
                  className: "flex-1 sm:flex-none w-full sm:w-32 bg-[#eee3cf] dark:bg-[#2f2f2f] text-[#4a2e1a] dark:text-[#d4c8b0] border-2 border-[#d1c7b8] dark:border-[#4a4a4a] px-2 py-1.5 rounded focus:outline-none focus:border-[#c99a4e]"
                }, Object.keys(CR_TO_XP).sort((a, b) => CR_TO_XP[a] - CR_TO_XP[b]).map(cr => React.createElement('option', { key: cr, value: cr }, `CR ${cr} (${CR_TO_XP[cr]} XP)`))),
                React.createElement('div', { className: "w-14 shrink-0" },
                  React.createElement(NumberInput, { isEncounter: true, min: "1", max: "99", value: c.count, onChange: e => updateCreature(c.id, { count: parseInt(e.target.value) || 1 }) })
                ),
                React.createElement('button', { onClick: () => confirmDeleteCreature(c.id), className: "text-red-700 dark:text-red-500 px-2 py-1 hover:bg-red-800/20 rounded shrink-0", title: "Remove creature type", 'aria-label': "Remove creature type" }, React.createElement(CloseIcon, { size: 18 }))
              )
            )
          ))
        ),
        React.createElement('button', { onClick: addCreature, className: "text-sm text-[#c99a4e] font-bold self-start hover:underline" }, "+ Add Creature Type")
      ),

      React.createElement('div', { className: "flex flex-wrap gap-2 items-end sm:ml-8 mt-2" },
        React.createElement(FormGroup, { label: "Base XP", isEncounter: true },
          React.createElement(NumberInput, { isEncounter: true, min: "0", value: derivedBaseXp, disabled: creatures.length > 0, onChange: e => onUpdate({ baseXp: parseInt(e.target.value) || 0 }) })
        ),
        creatures.length === 0 && React.createElement(FormGroup, { label: "Count", isEncounter: true },
          React.createElement(NumberInput, { isEncounter: true, min: "1", value: derivedCount, onChange: e => onUpdate({ count: parseInt(e.target.value) || 1 }) })
        ),
        React.createElement(FormGroup, { label: "XP / Share", title: `${xpAwardPercent ?? 50}% of Base XP / ${Math.max(1, xpShares || 1)} XP shares`, isEncounter: true },
          React.createElement('div', { className: "h-[38px] flex items-center justify-center text-base font-bold text-[#c99a4e] bg-[#c99a4e]/10 border-2 border-[#c99a4e]/30 rounded px-2 py-1.5" },
            playerXpAward.toLocaleString()
          )
        ),
        React.createElement(FormGroup, { label: "Overhang %", title: `Suggested: ${suggestedOverhang}%`, isEncounter: true },
          React.createElement(NumberInput, { 
            isEncounter: true,
            min: "0", max: "999", 
            value: encounter.localOverhangPercent ?? '', 
            onChange: e => onUpdate({ localOverhangPercent: e.target.value === '' ? null : parseInt(e.target.value) }),
            placeholder: suggestedOverhang.toString() 
          })
        ),
        React.createElement(FormGroup, { label: "Adjusted XP", isEncounter: true },
          React.createElement('div', { className: "h-[38px] flex items-center justify-center text-base font-bold text-[#c99a4e] bg-[#c99a4e]/10 border-2 border-[#c99a4e]/30 rounded px-2 py-1.5" },
            adjustedXp.toLocaleString()
          )
        )
      ),

      React.createElement('div', { className: "flex items-center gap-2 mt-1 sm:ml-8" },
        React.createElement('div', { className: "flex-1 h-2.5 bg-[#d1c7b8] dark:bg-[#1a1a1a] rounded-full overflow-hidden relative border-2 border-[#b8ab98] dark:border-[#4a4a4a]" },
          React.createElement('div', { 
            className: `h-full rounded-full transition-all duration-300 ${DIFFICULTY_COLORS[difficulty.level]}`,
            style: { width: `${difficulty.percentage}%` }
          }),
          React.createElement('div', { className: "absolute inset-0 flex pointer-events-none" },
            [...Array(5)].map((_, i) => React.createElement('div', { key: i, className: "flex-1 border-r-2 border-[#d1c7b8]/50 dark:border-[#4a4a4a]/50 last:border-r-0" }))
          )
        ),
        React.createElement('div', { className: `w-14 text-center text-sm font-bold uppercase tracking-wider ${DIFFICULTY_TEXT_COLORS[difficulty.level]}` },
          difficulty.level
        )
      ),

      creatureToDelete && React.createElement('div', { className: "fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4", onClick: () => setCreatureToDelete(null) },
        React.createElement('div', { className: "bg-[#f3eadd] dark:bg-[#2a2a2a] border-4 border-[#d1c7b8] dark:border-[#4a4a4a] w-full max-w-sm flex flex-col shadow-2xl", onClick: e => e.stopPropagation() },
            React.createElement('header', { className: "flex justify-between items-center p-4 border-b-4 border-red-800/40" },
                React.createElement('h2', { className: "text-xl font-bold font-medieval text-red-800 dark:text-red-500" }, "Delete Creature"),
                React.createElement('button', { onClick: () => setCreatureToDelete(null), className: "text-[#6d4f33] dark:text-[#a38b6d] hover:text-red-700", title: "Close", 'aria-label': "Close" }, React.createElement(CloseIcon, { size: 22 }))
            ),
            React.createElement('div', { className: "p-6 text-center" },
                React.createElement('p', { className: "text-lg text-[#6d4f33] dark:text-[#d4c8b0]" },
                    "Are you sure you want to remove this creature from the encounter?"
                )
            ),
            React.createElement('footer', { className: "flex justify-end gap-3 p-4 bg-[#eee3cf] dark:bg-[#2f2f2f]" },
                React.createElement('button', { onClick: () => setCreatureToDelete(null), className: "bg-transparent border-2 border-slate-500 text-slate-600 dark:text-slate-400 font-bold py-2 px-4 rounded-sm transition-colors hover:bg-slate-500/20" },
                    "Cancel"
                ),
                React.createElement('button', { onClick: deleteCreature, className: "bg-red-800 text-white font-bold py-2 px-4 rounded-sm transition-transform hover:scale-105 border-2 border-red-900" },
                    "Delete"
                )
            )
        )
      )
    )
  );
};


// --- AdventuringDay.tsx ---
const AdventuringDay = ({
  day,
  dailyBudget,
  globalOverhangPercent,
  minOverhangPercent,
  xpAwardPercent,
  xpShares,
  encounterThresholds,
  onUpdateDay,
  onDeleteDay,
  onAddEncounter,
  onDeleteEncounter,
  onUpdateEncounter,
  onReorderEncounters
}) => {
  const [draggedItemIndex, setDraggedItemIndex] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  
  const { totalUsedXp, ignoredXp } = useMemo(() => {
    return day.encounters.reduce((totals, enc) => {
      const creatures = enc.creatures || [];
      
      let suggestedOverhang = globalOverhangPercent;
      if (creatures.length > 0) {
        let totalXp = 0;
        let maxXp = 0;
        let totalCount = 0;
        creatures.forEach(c => {
          const xp = CR_TO_XP[c.cr] || 0;
          totalXp += xp * c.count;
          totalCount += c.count;
          if (xp > maxXp) maxXp = xp;
        });
        if (maxXp > 0 && totalCount > 0) {
          const averageXp = totalXp / totalCount;
          const ratio = Math.sqrt(averageXp / maxXp);
          const minO = minOverhangPercent || 0;
          const maxO = globalOverhangPercent || 0;
          suggestedOverhang = Math.round(minO + ratio * (maxO - minO));
        }
      }
      
      const overhang = enc.localOverhangPercent ?? suggestedOverhang;
      
      const derivedBaseXp = creatures.length > 0 
        ? creatures.reduce((sum, c) => sum + (CR_TO_XP[c.cr] || 0) * c.count, 0)
        : enc.baseXp;
        
      const derivedCount = creatures.length > 0
        ? creatures.reduce((sum, c) => sum + c.count, 0)
        : enc.count;
        
      const adjustedXp = calculateAdjustedXp(derivedBaseXp, derivedCount, overhang);
      const difficulty = getEncounterDifficulty(adjustedXp, encounterThresholds);

      // Trivial encounters still award their normal player XP, but they do not
      // consume any of the Adventuring Day budget.
      if (difficulty.level === 'trivial') {
        return { ...totals, ignoredXp: totals.ignoredXp + adjustedXp };
      }

      return { ...totals, totalUsedXp: totals.totalUsedXp + adjustedXp };
    }, { totalUsedXp: 0, ignoredXp: 0 });
  }, [day.encounters, globalOverhangPercent, minOverhangPercent, encounterThresholds]);
  
  const remainingXp = dailyBudget - totalUsedXp;

  const handleDragStart = (e, index) => {
    setDraggedItemIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };
  
  const handleDragOver = (e, index) => {
    e.preventDefault();
    if (index === draggedItemIndex) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const midpoint = rect.width / 2;
    const x = e.clientX - rect.left;
    const position = x < midpoint ? 'before' : 'after';

    if (dropTarget?.index !== index || dropTarget?.position !== position) {
      setDropTarget({ index, position });
    }
  };

  const handleDragLeave = () => {
    setDropTarget(null);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (draggedItemIndex === null || !dropTarget) return;

    let destIndex = dropTarget.index;
    if (dropTarget.position === 'after') {
      destIndex++;
    }

    if (draggedItemIndex < destIndex) {
      destIndex--;
    }
    
    if (draggedItemIndex !== destIndex) {
      onReorderEncounters(day.id, draggedItemIndex, destIndex);
    }
    
    setDraggedItemIndex(null);
    setDropTarget(null);
  };
  
  const handleDragEnd = () => {
    setDraggedItemIndex(null);
    setDropTarget(null);
  };

  const numEncounters = day.encounters.length;
  const gridColsClass = 
      numEncounters <= 1 ? 'grid-cols-1' :
      numEncounters === 2 ? 'grid-cols-1 md:grid-cols-2' :
      'grid-cols-1 md:grid-cols-2 xl:grid-cols-3';

  return (
    React.createElement('div', { className: "bg-[#f3eadd] dark:bg-[#2a2a2a]/70 border-4 border-[#d1c7b8] dark:border-[#4a4a4a] p-5 shadow-lg" },
      React.createElement('header', { className: "flex justify-between items-center gap-4 pb-3 mb-4 border-b-4 border-[#c99a4e]/40" },
        React.createElement('input', {
          type: "text",
          value: day.title,
          onChange: e => onUpdateDay(day.id, { title: e.target.value }),
          className: "bg-transparent text-2xl font-bold w-full focus:outline-none font-medieval",
          placeholder: `Adventuring Day ${day.id}`
        }),
        React.createElement('button', { onClick: () => onDeleteDay(day.id), className: "bg-red-800 text-[#f3eadd] font-bold py-2 px-4 rounded-sm shrink-0 transition-transform hover:scale-105 border-2 border-red-900" },
          "Delete Day"
        )
      ),
      
      React.createElement('button', { onClick: () => onAddEncounter(day.id), className: "w-full bg-transparent border-2 border-[#c99a4e]/50 text-[#c99a4e] font-bold py-2.5 px-4 rounded-sm mb-3 transition-colors hover:bg-[#c99a4e]/20" },
        "+ Add Encounter"
      ),

      React.createElement('div', { className: `grid gap-3 ${gridColsClass}` },
        day.encounters.map((encounter, index) => (
          React.createElement(EncounterCard, {
            key: encounter.id,
            encounter: encounter,
            globalOverhangPercent: globalOverhangPercent,
            minOverhangPercent: minOverhangPercent,
            xpAwardPercent: xpAwardPercent,
            xpShares: xpShares,
            encounterThresholds: encounterThresholds,
            onUpdate: updatedEncounter => onUpdateEncounter(day.id, encounter.id, updatedEncounter),
            onDelete: () => onDeleteEncounter(day.id, encounter.id),
            isDragging: draggedItemIndex === index,
            isDropTargetBefore: dropTarget?.index === index && dropTarget.position === 'before',
            isDropTargetAfter: dropTarget?.index === index && dropTarget.position === 'after',
            onDragStart: (e) => handleDragStart(e, index),
            onDragOver: (e) => handleDragOver(e, index),
            onDragLeave: handleDragLeave,
            onDrop: handleDrop,
            onDragEnd: handleDragEnd
          })
        ))
      ),

      React.createElement('footer', { className: "mt-4 pt-3 border-t-2 border-black/10 dark:border-white/10 flex justify-between items-center font-bold text-lg" },
        React.createElement('span', null, "Used XP: ", React.createElement('span', { className: "text-[#c99a4e]" }, totalUsedXp.toLocaleString())),
        React.createElement('span', null,
          "Remaining: ",
          React.createElement('span', { className: remainingXp >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-500' }, `${remainingXp.toLocaleString()} XP`),
          React.createElement('span', {
            className: "ml-2 text-sm text-slate-500 dark:text-slate-400",
            title: "Adjusted XP from Trivial encounters. These encounters award normal player XP but use 0% of the Daily Budget."
          }, ` (${ignoredXp.toLocaleString()} XP ignored)`)
        )
      )
    )
  );
};


// --- PartySetup.tsx ---
const PartySetup = ({ party, settings, dailyBudget, encounterThresholds, xpTable, onPartyChange, onSettingsChange, onXpTableUpdate, onXpTableReset }) => {
  const { trivial, easy, medium, hard, deadly } = encounterThresholds;
  const difficultyBoundaries = getDifficultyBoundaries(encounterThresholds);
  const easyMinXp = Math.ceil(difficultyBoundaries.trivialEasy);
  const mediumMinXp = Math.ceil(difficultyBoundaries.easyMedium);
  const hardMinXp = Math.ceil(difficultyBoundaries.mediumHard);
  const deadlyMinXp = Math.ceil(difficultyBoundaries.hardDeadly);
  const players = getPartyPlayers(party);
  const playerCount = players.length;
  const hirelings = Math.max(0, parseInt(party.hirelings, 10) || 0);
  const xpShares = getXpShares(party);
  const averageLevel = getAveragePartyLevel(party);
  const effectiveBudgetLevel = getEffectiveBudgetLevel(party);
  const budgetMode = party.budgetMode || 'average';
  const hasLevelOverride = party.levelOverride !== null && party.levelOverride !== undefined && party.levelOverride !== '';
  const baseThresholds = xpTable[effectiveBudgetLevel];
  const baseDailyPerPlayer = baseThresholds ? baseThresholds.high * 3 : 0;
  const suggestedBudgetMultiplier = getSuggestedBudgetMultiplier(effectiveBudgetLevel);
  const suggestedXpAwardPercent = getSuggestedXpAwardPercent(effectiveBudgetLevel);
  const budgetMultiplierMode = settings.budgetMultiplierMode || 'manual';
  const xpAwardMode = settings.xpAwardMode || 'manual';
  const effectiveBudgetMultiplier = getEffectiveBudgetMultiplier(settings, effectiveBudgetLevel);
  const xpAwardPercent = getEffectiveXpAwardPercent(settings, effectiveBudgetLevel);
  const isBudgetAuto = budgetMultiplierMode === 'auto';
  const isXpAwardAuto = xpAwardMode === 'auto';
  const effectiveDailyPerPlayer = Math.round(baseDailyPerPlayer * effectiveBudgetMultiplier);

  const updatePlayer = (id, updates) => {
    const nextPlayers = players.map(player => player.id === id ? { ...player, ...updates } : player);
    onPartyChange({ players: nextPlayers });
  };

  const addPlayer = () => {
    const fallbackLevel = effectiveBudgetLevel || 1;
    onPartyChange({
      players: [...players, { id: crypto.randomUUID(), name: `Player ${players.length + 1}`, level: fallbackLevel }]
    });
  };

  const deletePlayer = (id) => {
    if (players.length <= 1) return;
    onPartyChange({ players: players.filter(player => player.id !== id) });
  };
  
  return (
    React.createElement(React.Fragment, null,
      React.createElement(Panel, null,
        React.createElement('h3', { className: "m-0 mb-4 text-2xl font-bold text-[#c99a4e] font-medieval" }, "Party Setup"),

        React.createElement('div', { className: "mb-5" },
          React.createElement('div', { className: "flex justify-between items-center mb-2" },
            React.createElement('label', { className: "block text-base font-bold text-[#6d4f33] dark:text-[#a38b6d]" }, "Players"),
            React.createElement('button', { onClick: addPlayer, className: "text-sm text-[#c99a4e] font-bold hover:underline" }, "+ Add Player")
          ),
          React.createElement('div', { className: "space-y-2" },
            players.map((player, index) => (
              React.createElement('div', { key: player.id, className: "flex items-center gap-2" },
                React.createElement('input', {
                  type: "text",
                  value: player.name,
                  onChange: e => updatePlayer(player.id, { name: e.target.value }),
                  placeholder: `Player ${index + 1}`,
                  className: "flex-1 bg-[#eee3cf] dark:bg-[#2f2f2f] text-[#4a2e1a] dark:text-[#d4c8b0] border-2 border-[#d1c7b8] dark:border-[#4a4a4a] px-2 py-1.5 rounded focus:outline-none focus:border-[#c99a4e]"
                }),
                React.createElement('div', { className: "w-20" },
                  React.createElement(NumberInput, {
                    min: "1", max: "20",
                    value: player.level,
                    onChange: e => updatePlayer(player.id, { level: clampLevel(e.target.value) })
                  })
                ),
                React.createElement('button', {
                  onClick: () => deletePlayer(player.id),
                  disabled: players.length <= 1,
                  title: "Remove player",
                  'aria-label': "Remove player",
                  className: "text-red-700 dark:text-red-500 font-bold px-2 py-1 hover:bg-red-800/20 rounded disabled:opacity-40 disabled:cursor-not-allowed"
                }, React.createElement(CloseIcon, { size: 18 }))
              )
            ))
          )
        ),

        React.createElement(FormRow, null,
          React.createElement(FormGroup, { label: "Hirelings / Mercs XP Shares" },
            React.createElement(NumberInput, {
              min: "0", max: "99",
              value: hirelings,
              onChange: e => onPartyChange({ hirelings: Math.max(0, parseInt(e.target.value) || 0) })
            })
          ),
          React.createElement(FormGroup, { label: "Budget Level Override" },
            React.createElement(NumberInput, {
              min: "1", max: "20",
              value: party.levelOverride ?? '',
              placeholder: `Auto ${effectiveBudgetLevel}`,
              onChange: e => onPartyChange({ levelOverride: e.target.value === '' ? null : clampLevel(e.target.value) })
            })
          )
        ),

        React.createElement('div', { className: "mt-5" },
          React.createElement('label', { className: "block text-base font-bold text-[#6d4f33] dark:text-[#a38b6d] mb-2" }, "Budget Mode"),
          React.createElement('div', { className: "grid grid-cols-2 gap-2" },
            React.createElement('button', {
              onClick: () => onPartyChange({ budgetMode: 'average' }),
              className: `font-bold py-2 px-3 rounded-sm border-2 transition-colors ${budgetMode === 'average' ? 'bg-[#c99a4e] border-[#ab813e] text-[#f3eadd]' : 'bg-transparent border-[#c99a4e]/50 text-[#c99a4e] hover:bg-[#c99a4e]/20'}`
            }, "Average Level"),
            React.createElement('button', {
              onClick: () => onPartyChange({ budgetMode: 'sum' }),
              className: `font-bold py-2 px-3 rounded-sm border-2 transition-colors ${budgetMode === 'sum' ? 'bg-[#c99a4e] border-[#ab813e] text-[#f3eadd]' : 'bg-transparent border-[#c99a4e]/50 text-[#c99a4e] hover:bg-[#c99a4e]/20'}`
            }, "Sum Levels")
          ),
          React.createElement('div', { className: "mt-2 text-xs text-slate-600 dark:text-slate-400 leading-relaxed" },
            budgetMode === 'average'
              ? "Budget uses Effective Budget Level x player count. Good for mixed-level parties where low-level replacement characters should still matter."
              : "Budget sums each player's real level threshold. More RAW-like, but harsher for very low-level replacement characters."
          )
        ),

        React.createElement('div', { className: "grid grid-cols-2 gap-2 mt-5 text-sm" },
          React.createElement('div', { className: "bg-[#c99a4e]/10 border-2 border-[#c99a4e]/30 p-2" },
            React.createElement('strong', { className: "text-[#6d4f33] dark:text-[#a38b6d]" }, "Players"),
            React.createElement('br'),
            React.createElement('span', { className: "text-[#c99a4e] font-bold" }, playerCount)
          ),
          React.createElement('div', { className: "bg-[#c99a4e]/10 border-2 border-[#c99a4e]/30 p-2" },
            React.createElement('strong', { className: "text-[#6d4f33] dark:text-[#a38b6d]" }, "XP Shares"),
            React.createElement('br'),
            React.createElement('span', { className: "text-[#c99a4e] font-bold" }, xpShares)
          ),
          React.createElement('div', { className: "bg-[#c99a4e]/10 border-2 border-[#c99a4e]/30 p-2" },
            React.createElement('strong', { className: "text-[#6d4f33] dark:text-[#a38b6d]" }, "Average Level"),
            React.createElement('br'),
            React.createElement('span', { className: "text-[#c99a4e] font-bold" }, averageLevel.toFixed(2))
          ),
          React.createElement('div', { className: "bg-[#c99a4e]/10 border-2 border-[#c99a4e]/30 p-2" },
            React.createElement('strong', { className: "text-[#6d4f33] dark:text-[#a38b6d]" }, "Effective Level"),
            React.createElement('br'),
            React.createElement('span', { className: "text-[#c99a4e] font-bold" }, effectiveBudgetLevel),
            hasLevelOverride && React.createElement('span', { className: "ml-1 text-xs text-amber-700 dark:text-amber-400" }, "Override")
          )
        ),

        React.createElement('div', { className: "mt-6" },
          React.createElement('div', { className: "flex justify-between items-center gap-2 mb-2" },
            React.createElement('label', { className: "block text-base font-bold text-[#6d4f33] dark:text-[#a38b6d]" }, "Budget Multiplier"),
            React.createElement('div', { className: "flex items-center gap-2" },
              React.createElement('span', { className: `text-xs font-bold px-2 py-0.5 border rounded-sm ${isBudgetAuto ? 'text-green-700 dark:text-green-400 border-green-700/40 bg-green-700/10' : 'text-amber-700 dark:text-amber-400 border-amber-700/40 bg-amber-700/10'}` }, isBudgetAuto ? "AUTO" : "MANUAL"),
              React.createElement('button', {
                onClick: () => onSettingsChange({ budgetMultiplierMode: 'auto', budgetMultiplier: suggestedBudgetMultiplier }),
                disabled: isBudgetAuto,
                className: "text-xs font-bold px-2 py-1 border-2 border-[#c99a4e]/50 text-[#c99a4e] rounded-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#c99a4e]/20"
              }, "Use Suggested")
            )
          ),
          React.createElement('div', { className: "flex items-center gap-3" },
            React.createElement(RangeInputWithGhost, {
              min: "0.5", max: "2", step: "0.05",
              value: effectiveBudgetMultiplier,
              suggestedValue: suggestedBudgetMultiplier,
              onChange: e => onSettingsChange({ budgetMultiplier: parseFloat(e.target.value), budgetMultiplierMode: 'manual' })
            }),
            React.createElement('span', { className: "min-w-[45px] text-center font-bold text-lg text-[#c99a4e]" }, effectiveBudgetMultiplier.toFixed(2))
          ),
          React.createElement('div', { className: "mt-1 text-xs text-slate-600 dark:text-slate-400" },
            `Suggested for Effective Level ${effectiveBudgetLevel}: ${suggestedBudgetMultiplier.toFixed(2)}`
          )
        ),

        React.createElement('div', { className: "mt-6" },
          React.createElement('div', { className: "flex justify-between items-center gap-2 mb-2" },
            React.createElement('label', { className: "block text-base font-bold text-[#6d4f33] dark:text-[#a38b6d]" }, "Player XP Award %"),
            React.createElement('div', { className: "flex items-center gap-2" },
              React.createElement('span', { className: `text-xs font-bold px-2 py-0.5 border rounded-sm ${isXpAwardAuto ? 'text-green-700 dark:text-green-400 border-green-700/40 bg-green-700/10' : 'text-amber-700 dark:text-amber-400 border-amber-700/40 bg-amber-700/10'}` }, isXpAwardAuto ? "AUTO" : "MANUAL"),
              React.createElement('button', {
                onClick: () => onSettingsChange({ xpAwardMode: 'auto', xpAwardPercent: suggestedXpAwardPercent }),
                disabled: isXpAwardAuto,
                className: "text-xs font-bold px-2 py-1 border-2 border-[#c99a4e]/50 text-[#c99a4e] rounded-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#c99a4e]/20"
              }, "Use Suggested")
            )
          ),
          React.createElement('div', { className: "flex items-center gap-3" },
            React.createElement(RangeInputWithGhost, {
              min: "25", max: "100", step: "5",
              value: xpAwardPercent,
              suggestedValue: suggestedXpAwardPercent,
              onChange: e => onSettingsChange({ xpAwardPercent: parseInt(e.target.value), xpAwardMode: 'manual' })
            }),
            React.createElement('span', { className: "min-w-[45px] text-center font-bold text-lg text-[#c99a4e]" }, `${xpAwardPercent}%`)
          ),
          React.createElement('div', { className: "mt-1 text-xs text-slate-600 dark:text-slate-400" },
            `Suggested for Effective Level ${effectiveBudgetLevel}: ${suggestedXpAwardPercent}%`
          )
        ),

        React.createElement('div', { className: "mt-6" },
          React.createElement('label', { className: "block text-base font-bold text-[#6d4f33] dark:text-[#a38b6d] mb-2" }, "Min Overhang Bonus %"),
          React.createElement('div', { className: "flex items-center gap-3" },
            React.createElement(RangeInput, {
              min: "0", max: "10", step: "1",
              value: settings.minOverhangPercent || 0,
              onChange: e => onSettingsChange({ minOverhangPercent: parseInt(e.target.value) })
            }),
            React.createElement('span', { className: "min-w-[45px] text-center font-bold text-lg text-[#c99a4e]" }, `${settings.minOverhangPercent || 0}%`)
          )
        ),

        React.createElement('div', { className: "mt-6" },
          React.createElement('label', { className: "block text-base font-bold text-[#6d4f33] dark:text-[#a38b6d] mb-2" }, "Max Overhang Bonus %"),
          React.createElement('div', { className: "flex items-center gap-3" },
            React.createElement(RangeInput, {
              min: "0", max: "10", step: "1",
              value: settings.globalOverhangPercent,
              onChange: e => onSettingsChange({ globalOverhangPercent: parseInt(e.target.value) })
            }),
            React.createElement('span', { className: "min-w-[45px] text-center font-bold text-lg text-[#c99a4e]" }, `${settings.globalOverhangPercent}%`)
          )
        ),
        
        React.createElement('div', { className: "bg-[#c99a4e]/10 p-4 mt-6 border-2 border-[#c99a4e]/30 text-center font-bold text-xl text-[#c99a4e]" },
          `Daily XP Budget: ${dailyBudget.toLocaleString()} XP`
        )
      ),
      React.createElement(Panel, null,
          React.createElement('h4', { className: "m-0 mb-3 text-xl font-bold text-[#c99a4e] font-medieval" }, "XP Information"),
          React.createElement('div', { className: "text-base space-y-3" },
              React.createElement('div', { className: "leading-relaxed" },
                  React.createElement('strong', { className: "text-[#6d4f33] dark:text-[#a38b6d]" }, "Budget Basis:"),
                  React.createElement('br'),
                  React.createElement('span', { className: "text-slate-700 dark:text-slate-400" }, budgetMode === 'average' ? `Average Mode: Level ${effectiveBudgetLevel} x ${playerCount} players` : `Sum Mode: ${playerCount} individual player levels`),
                  React.createElement('br'),
                  React.createElement('span', { className: "text-xs text-slate-500" }, `Budget Multiplier: ${effectiveBudgetMultiplier.toFixed(2)} | Suggested: ${suggestedBudgetMultiplier.toFixed(2)}`)
              ),
              React.createElement('div', { className: "leading-relaxed" },
                  React.createElement('strong', { className: "text-[#6d4f33] dark:text-[#a38b6d]" }, "Player XP Award:"),
                  React.createElement('br'),
                  React.createElement('span', { className: "text-slate-700 dark:text-slate-400" }, `${xpAwardPercent}% of Base XP / ${xpShares} XP shares`),
                  React.createElement('br'),
                  React.createElement('span', { className: "text-xs text-slate-500" }, `Mode: ${isXpAwardAuto ? 'Auto' : 'Manual'} | Suggested: ${suggestedXpAwardPercent}%`)
              ),
              React.createElement('div', { className: "leading-relaxed" },
                React.createElement('strong', { className: "text-[#6d4f33] dark:text-[#a38b6d]" }, "Encounter Difficulties:"),
                React.createElement('br'),
                React.createElement(DifficultyLegendLabel, { colorClass: "bg-slate-500", className: "text-slate-500", text: "Trivial:" }), ` < ${easyMinXp.toLocaleString()} XP (mid ${trivial.toLocaleString()})`,
                React.createElement('br'),
                React.createElement(DifficultyLegendLabel, { colorClass: "bg-sky-600", className: "text-sky-600 dark:text-sky-400", text: "Easy:" }), ` ${easyMinXp.toLocaleString()}–${(mediumMinXp - 1).toLocaleString()} XP (mid ${easy.toLocaleString()})`,
                React.createElement('br'),
                React.createElement(DifficultyLegendLabel, { colorClass: "bg-green-600", className: "text-green-700 dark:text-green-400", text: "Medium:" }), ` ${mediumMinXp.toLocaleString()}–${(hardMinXp - 1).toLocaleString()} XP (mid ${medium.toLocaleString()})`,
                React.createElement('br'),
                React.createElement(DifficultyLegendLabel, { colorClass: "bg-amber-600", className: "text-amber-700 dark:text-amber-400", text: "Hard:" }), ` ${hardMinXp.toLocaleString()}–${(deadlyMinXp - 1).toLocaleString()} XP (mid ${hard.toLocaleString()})`,
                React.createElement('br'),
                React.createElement(DifficultyLegendLabel, { colorClass: "bg-red-700", className: "text-red-800 dark:text-red-500", text: "Deadly:" }), ` ${deadlyMinXp.toLocaleString()}+ XP (mid ${deadly.toLocaleString()})`
              )
          )
      ),
      React.createElement(XpMatrix, { 
        level: effectiveBudgetLevel,
        xpTable: xpTable,
        onUpdate: onXpTableUpdate,
        onReset: onXpTableReset
      })
    )
  );
};


// =================================================================================
// MAIN APP COMPONENT (from App.tsx)
// =================================================================================

const initialAppState = {
  party: {
    players: createDefaultPlayers(4, 1),
    hirelings: 0,
    budgetMode: 'average',
    levelOverride: null,
  },
  settings: {
    budgetMultiplier: 1.0,
    budgetMultiplierMode: 'auto',
    globalOverhangPercent: 10,
    minOverhangPercent: 0,
    xpAwardPercent: 50,
    xpAwardMode: 'auto',
  },
  days: [],
  xpThresholdsTable: XP_THRESHOLDS_PER_LEVEL,
};

const createNewSaveSlot = (appState, name) => ({
    id: crypto.randomUUID(),
    name,
    lastModified: Date.now(),
    appState: normalizeAppState(appState),
});

const normalizeSettings = (settings = {}) => {
  const hasBudgetMode = Object.prototype.hasOwnProperty.call(settings, 'budgetMultiplierMode');
  const hasXpAwardMode = Object.prototype.hasOwnProperty.call(settings, 'xpAwardMode');

  return {
    ...initialAppState.settings,
    ...settings,
    budgetMultiplierMode: hasBudgetMode ? settings.budgetMultiplierMode : 'manual',
    xpAwardMode: hasXpAwardMode ? settings.xpAwardMode : 'manual',
  };
};

const normalizeParty = (party = {}) => {
  const players = getPartyPlayers(party);
  return {
    ...initialAppState.party,
    ...party,
    players,
    hirelings: Math.max(0, parseInt(party.hirelings, 10) || 0),
    budgetMode: party.budgetMode === 'sum' ? 'sum' : 'average',
    levelOverride: party.levelOverride === '' || party.levelOverride === undefined ? null : party.levelOverride,
  };
};

const normalizeAppState = (appState = {}) => ({
  ...initialAppState,
  ...appState,
  party: normalizeParty(appState.party || {}),
  settings: normalizeSettings(appState.settings || {}),
  days: Array.isArray(appState.days) ? appState.days : [],
  xpThresholdsTable: appState.xpThresholdsTable || initialAppState.xpThresholdsTable,
});

const normalizeSaveData = (data) => {
  if (!data || !Array.isArray(data.saveSlots) || data.saveSlots.length === 0) return null;
  const saveSlots = data.saveSlots.map(slot => ({
    ...slot,
    appState: normalizeAppState(slot.appState || {}),
  }));
  const activeSlotId = saveSlots.some(slot => slot.id === data.activeSlotId)
    ? data.activeSlotId
    : saveSlots[0].id;
  return { ...data, activeSlotId, saveSlots };
};

const loadSaveData = () => {
  try {
    const serializedData = localStorage.getItem('dndPlannerSaveData');
    if (serializedData) {
      const data = JSON.parse(serializedData);
      const normalizedData = normalizeSaveData(data);
      if (normalizedData) {
        return normalizedData;
      }
    }
    
    // Migration from old single-state format
    const oldSerializedState = localStorage.getItem('dndPlannerState');
    if (oldSerializedState) {
        const oldState = JSON.parse(oldSerializedState);
        if (oldState.party && oldState.settings && Array.isArray(oldState.days)) {
            const migratedState = normalizeAppState(oldState);
            const newSlot = createNewSaveSlot(migratedState, "Standard-Speicherstand");
            return { activeSlotId: newSlot.id, saveSlots: [newSlot] };
        }
    }
    
    // Create new default if nothing exists
    const defaultSlot = createNewSaveSlot(initialAppState, "Standard-Speicherstand");
    return { activeSlotId: defaultSlot.id, saveSlots: [defaultSlot] };

  } catch (error) {
    console.error("Error loading state from localStorage:", error);
    const defaultSlot = createNewSaveSlot(initialAppState, "Standard-Speicherstand");
    return { activeSlotId: defaultSlot.id, saveSlots: [defaultSlot] };
  }
};


function App() {
  const [saveData, setSaveData] = useState(loadSaveData);
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [slotToDelete, setSlotToDelete] = useState(null);
  const [dayToDelete, setDayToDelete] = useState(null);
  const [renamingSlotId, setRenamingSlotId] = useState(null);
  const isInitialMount = useRef(true);

  const activeAppState = useMemo(() => {
    const activeSlot = saveData.saveSlots.find(s => s.id === saveData.activeSlotId);
    return activeSlot ? activeSlot.appState : initialAppState;
  }, [saveData]);
  
  const [
    state,
    setState,
    undo,
    redo,
    canUndo,
    canRedo
  ] = useUndoRedo(activeAppState);
  
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'auto');

  useEffect(() => {
    const root = window.document.documentElement;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const applyDarkMode = () => {
      const isSystemDark = mediaQuery.matches;
      if (theme === 'dark' || (theme === 'auto' && isSystemDark)) {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }
    };

    applyDarkMode();
    localStorage.setItem('theme', theme);

    const handleChange = () => {
      if (theme === 'auto') {
        applyDarkMode();
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);


  const { party, settings, days, xpThresholdsTable } = state;

  const saveDataRef = useRef(saveData);
  useEffect(() => {
    saveDataRef.current = saveData;
  });

  // Auto-save logic, refactored to prevent race conditions.
  useEffect(() => {
    // Don't save on initial mount.
    if (isInitialMount.current) {
        isInitialMount.current = false;
        return;
    }

    const currentSaveData = saveDataRef.current;
    if (!currentSaveData.activeSlotId) return;

    const activeSlot = currentSaveData.saveSlots.find(slot => slot.id === currentSaveData.activeSlotId);
    
    // Prevent saving if the state is identical to what's already saved.
    if (activeSlot && JSON.stringify(activeSlot.appState) === JSON.stringify(state)) {
      return;
    }

    const updatedSaveData = {
        ...currentSaveData,
        saveSlots: currentSaveData.saveSlots.map(slot => 
            slot.id === currentSaveData.activeSlotId 
            ? { ...slot, appState: state, lastModified: Date.now() }
            : slot
        )
    };

    try {
      localStorage.setItem('dndPlannerSaveData', JSON.stringify(updatedSaveData));
      // Keep React state in sync with localStorage to avoid stale data (e.g., lastModified date)
      setSaveData(updatedSaveData);
    } catch (error) {
      console.error("Error saving state to localStorage:", error);
    }
    // This effect should ONLY run when the user-manipulated state changes.
    // It uses a ref to get the latest saveData without creating a dependency on it,
    // which was the source of the race condition.
  }, [state]);

  const effectiveBudgetLevel = useMemo(() => getEffectiveBudgetLevel(party), [party]);
  const xpShares = useMemo(() => getXpShares(party), [party]);
  const effectiveBudgetMultiplier = useMemo(() => getEffectiveBudgetMultiplier(settings, effectiveBudgetLevel), [settings, effectiveBudgetLevel]);
  const effectiveXpAwardPercent = useMemo(() => getEffectiveXpAwardPercent(settings, effectiveBudgetLevel), [settings, effectiveBudgetLevel]);
  const dailyBudget = useMemo(() => calculateDailyBudget(party, effectiveBudgetMultiplier, xpThresholdsTable), [party, effectiveBudgetMultiplier, xpThresholdsTable]);
  const encounterThresholds = useMemo(() => calculateEncounterThresholds(party, effectiveBudgetMultiplier, xpThresholdsTable), [party, effectiveBudgetMultiplier, xpThresholdsTable]);

  const updateParty = useCallback((newParty) => {
    setState({ ...state, party: { ...party, ...newParty } });
  }, [state, setState]);

  const updateSettings = useCallback((newSettings) => {
    setState({ ...state, settings: { ...settings, ...newSettings } });
  }, [state, setState]);

  const updateXpTable = useCallback((level, key, value) => {
    const newTable = {
      ...xpThresholdsTable,
      [level]: {
        ...xpThresholdsTable[level],
        [key]: value
      }
    };
    setState({ ...state, xpThresholdsTable: newTable });
  }, [state, setState]);

  const resetXpTableForLevel = useCallback((level) => {
    const newTable = {
      ...xpThresholdsTable,
      [level]: XP_THRESHOLDS_PER_LEVEL[level]
    };
    setState({ ...state, xpThresholdsTable: newTable });
  }, [state, setState]);

  const addDay = useCallback(() => {
    const newDay = {
      id: crypto.randomUUID(),
      title: `Adventuring Day ${days.length + 1}`,
      encounters: [],
    };
    setState({ ...state, days: [...days, newDay] });
  }, [state, setState]);

  const deleteDay = useCallback((dayId) => {
    setState({ ...state, days: days.filter(d => d.id !== dayId) });
  }, [state, setState]);

  const requestDeleteDay = useCallback((dayId) => {
    const day = days.find(d => d.id === dayId);
    if (day) {
      setDayToDelete(day);
    }
  }, [days]);

  const confirmDeleteDay = useCallback(() => {
    if (!dayToDelete) return;
    deleteDay(dayToDelete.id);
    setDayToDelete(null);
  }, [dayToDelete, deleteDay]);

  const updateDay = useCallback((dayId, updatedDay) => {
    setState({ ...state, days: days.map(d => d.id === dayId ? { ...d, ...updatedDay } : d) });
  }, [state, setState]);

  const addEncounter = useCallback((dayId) => {
    const day = days.find(d => d.id === dayId);
    if (!day) return;
    const newEncounter = {
      id: crypto.randomUUID(),
      name: `Encounter ${day.encounters.length + 1}`,
      baseXp: 100,
      count: 1,
      localOverhangPercent: null,
    };
    const newDays = days.map(d => {
      if (d.id === dayId) {
        return { ...d, encounters: [...d.encounters, newEncounter] };
      }
      return d;
    });
    setState({ ...state, days: newDays });
  }, [state, setState]);

  const deleteEncounter = useCallback((dayId, encounterId) => {
    const newDays = days.map(d => {
      if (d.id === dayId) {
        return { ...d, encounters: d.encounters.filter(e => e.id !== encounterId) };
      }
      return d;
    });
    setState({ ...state, days: newDays });
  }, [state, setState]);

  const updateEncounter = useCallback((dayId, encounterId, updatedEncounter) => {
     const newDays = days.map(d => {
      if (d.id === dayId) {
        return { ...d, encounters: d.encounters.map(e => e.id === encounterId ? {...e, ...updatedEncounter} : e) };
      }
      return d;
    });
    setState({ ...state, days: newDays });
  }, [state, setState]);
  
  const reorderEncounters = useCallback((dayId, sourceIndex, destIndex) => {
    const day = days.find(d => d.id === dayId);
    if (!day) return;
    
    const reorderedEncounters = Array.from(day.encounters);
    const [removed] = reorderedEncounters.splice(sourceIndex, 1);
    reorderedEncounters.splice(destIndex, 0, removed);

    updateDay(dayId, { encounters: reorderedEncounters });
  }, [days, updateDay]);

  // Save Management Handlers
  const handleLoadSlot = (slotId) => {
    const slotToLoad = saveData.saveSlots.find(s => s.id === slotId);
    if (!slotToLoad || slotId === saveData.activeSlotId) {
        setIsSaveModalOpen(false);
        return;
    }

    // 1. Update the active slot ID.
    setSaveData(prev => ({ ...prev, activeSlotId: slotId }));
    
    // 2. Explicitly set the app's live state to the loaded data.
    // This triggers the undo/redo history to reset for the new context.
    setState(slotToLoad.appState, true);

    setIsSaveModalOpen(false);
  };
  
  const handleSaveNewSlot = () => {
    const name = `Neuer Speicherstand ${saveData.saveSlots.length + 1}`;
    // Creates a new slot with a clean initial state.
    const newSlot = createNewSaveSlot(initialAppState, name);
    setSaveData(prev => ({
        ...prev,
        saveSlots: [...prev.saveSlots, newSlot],
    }));
    // We don't switch to it, just create it and allow renaming.
    setRenamingSlotId(newSlot.id);
  };
  
  const handleRequestDelete = (slotId) => {
    const slot = saveData.saveSlots.find(s => s.id === slotId);
    if (slot) {
        setSlotToDelete(slot);
    }
  };

  const handleConfirmDelete = () => {
    if (!slotToDelete) return;

    const remainingSlots = saveData.saveSlots.filter(s => s.id !== slotToDelete.id);
    let newActiveId = saveData.activeSlotId;
    
    // If we deleted the active slot, we must select a new one.
    if (newActiveId === slotToDelete.id) {
        if (remainingSlots.length > 0) {
            newActiveId = remainingSlots[0].id;
            // Explicitly load the state of the new active slot.
            setState(remainingSlots[0].appState, true);
        } else {
            // All slots were deleted, create a new default one.
            const defaultSlot = createNewSaveSlot(initialAppState, "Standard-Speicherstand");
            remainingSlots.push(defaultSlot);
            newActiveId = defaultSlot.id;
            setState(defaultSlot.appState, true);
        }
    }
    
    setSaveData({ saveSlots: remainingSlots, activeSlotId: newActiveId });
    setSlotToDelete(null);
  };

  const handleRenameSlot = (slotId, newName) => {
    const newSaveData = {
        ...saveData,
        saveSlots: saveData.saveSlots.map(s => s.id === slotId ? { ...s, name: newName, lastModified: Date.now() } : s)
    };
    setSaveData(newSaveData);
    localStorage.setItem('dndPlannerSaveData', JSON.stringify(newSaveData));
  };
  
  const handleCopySlot = (slotId) => {
    const originalSlot = saveData.saveSlots.find(s => s.id === slotId);
    if (!originalSlot) return;
    const newSlot = createNewSaveSlot(originalSlot.appState, `Kopie von ${originalSlot.name}`);
    const newSaveData = {
        ...saveData,
        saveSlots: [...saveData.saveSlots, newSlot]
    };
    setSaveData(newSaveData);
    localStorage.setItem('dndPlannerSaveData', JSON.stringify(newSaveData));
  };

  const handleExportSlot = (slotId) => {
    const slot = saveData.saveSlots.find(s => s.id === slotId);
    if (!slot) return;

    const dataStr = JSON.stringify(slot.appState, null, 2);
    const dataBlob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement("a");
    link.download = `${slot.name.replace(/ /g, '_')}.json`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImportSlot = (file) => {
    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const importedState = JSON.parse(event.target?.result);
            if (importedState.party && importedState.settings && Array.isArray(importedState.days)) {
                const name = file.name.replace(/\.json$/, '');
                const newSlot = createNewSaveSlot(importedState, name);
                 const newSaveData = {
                    ...saveData,
                    saveSlots: [...saveData.saveSlots, newSlot]
                };
                setSaveData(newSaveData);
                localStorage.setItem('dndPlannerSaveData', JSON.stringify(newSaveData));
            } else {
                alert("Error: The imported file does not appear to be a valid save.");
            }
        } catch (error) {
            alert("Error reading the file. Make sure it is a valid JSON file.");
        }
    };
    reader.readAsText(file);
  };

  const AppButton = ({onClick, disabled = false, children, title}) => (
    React.createElement('button', {
      onClick: onClick, 
      disabled: disabled, 
      title: title,
      className: "bg-[#d1c7b8] dark:bg-[#4a4a4a] text-[#6d4f33] dark:text-[#a38b6d] font-bold p-2 rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors hover:enabled:bg-[#b8ab98] dark:hover:enabled:bg-[#5a5a5a] border-2 border-[#b8ab98] dark:border-[#5a5a5a]"
    }, children)
  );

  const activeSlotName = useMemo(() => 
    saveData.saveSlots.find(s => s.id === saveData.activeSlotId)?.name,
    [saveData]
  );

  return (
    React.createElement('div', { className: "max-w-[1800px] h-[calc(100vh-48px)] mx-auto flex flex-col overflow-hidden" },
      React.createElement(GlobalUiStyles, null),
      React.createElement('header', { className: "flex justify-between items-start sm:items-center mb-4" },
        React.createElement('div', null,
          React.createElement('h1', { className: "text-3xl sm:text-4xl font-bold text-[#6d4f33] dark:text-[#d4c8b0]" }, "Encounter Planner"),
          activeSlotName && (
            React.createElement('p', { className: "text-sm text-[#c99a4e] font-bold mt-1 tracking-wide" },
              "Aktiver Speicherstand: ", React.createElement('span', { className: "underline decoration-dotted" }, activeSlotName)
            )
          )
        ),
        React.createElement('div', { className: "flex items-center gap-2 shrink-0" },
          React.createElement(ThemeSwitcher, { theme: theme, setTheme: setTheme }),
          React.createElement(AppButton, { onClick: () => setIsSaveModalOpen(true), title: "Manage Saves" }, React.createElement(SaveIcon)),
          React.createElement(AppButton, { onClick: undo, disabled: !canUndo, title: "Undo" }, React.createElement(UndoIcon)),
          React.createElement(AppButton, { onClick: redo, disabled: !canRedo, title: "Redo" }, React.createElement(RedoIcon))
        )
      ),
      React.createElement('main', { className: "grid grid-cols-1 lg:grid-cols-[400px_minmax(0,1fr)] gap-6 flex-1 min-h-0" },
        React.createElement('aside', { className: "flex flex-col gap-6 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:pr-2 custom-scrollbar" },
          React.createElement(PartySetup, { 
            party: party, 
            settings: settings,
            dailyBudget: dailyBudget,
            encounterThresholds: encounterThresholds,
            xpTable: xpThresholdsTable,
            onPartyChange: updateParty,
            onSettingsChange: updateSettings,
            onXpTableUpdate: updateXpTable,
            onXpTableReset: resetXpTableForLevel
          })
        ),

        React.createElement('section', { className: "flex flex-col gap-4 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:pr-2 custom-scrollbar" },
          React.createElement('button', { onClick: addDay, className: "sticky top-0 z-20 w-full bg-[#c99a4e] text-[#f3eadd] font-bold py-3 px-4 rounded-sm text-lg transition-colors hover:bg-[#d6a658] border-2 border-[#ab813e] shadow-md hover:shadow-lg" },
            "+ Add Adventuring Day"
          ),
          React.createElement('div', { className: "flex flex-col gap-6" },
            days.map(day => (
              React.createElement(AdventuringDay, { 
                key: day.id,
                day: day,
                dailyBudget: dailyBudget,
                globalOverhangPercent: settings.globalOverhangPercent,
                minOverhangPercent: settings.minOverhangPercent,
                xpAwardPercent: effectiveXpAwardPercent,
                xpShares: xpShares,
                encounterThresholds: encounterThresholds,
                onUpdateDay: updateDay,
                onDeleteDay: requestDeleteDay,
                onAddEncounter: addEncounter,
                onDeleteEncounter: deleteEncounter,
                onUpdateEncounter: updateEncounter,
                onReorderEncounters: reorderEncounters
              })
            ))
          )
        )
      ),
      React.createElement(SaveManagerModal, { 
        isOpen: isSaveModalOpen,
        onClose: () => {
            setIsSaveModalOpen(false);
            setRenamingSlotId(null);
        },
        saveData: saveData,
        onLoad: handleLoadSlot,
        onSaveNew: handleSaveNewSlot,
        onDelete: handleRequestDelete,
        onRename: handleRenameSlot,
        onCopy: handleCopySlot,
        onExport: handleExportSlot,
        onImport: handleImportSlot,
        renamingId: renamingSlotId,
        setRenamingId: setRenamingSlotId
      }),
      React.createElement(ConfirmDeleteModal, { 
        isOpen: !!slotToDelete,
        onClose: () => setSlotToDelete(null),
        onConfirm: handleConfirmDelete,
        slotName: slotToDelete?.name || ''
      }),
      React.createElement(ConfirmDeleteDayModal, {
        isOpen: !!dayToDelete,
        onClose: () => setDayToDelete(null),
        onConfirm: confirmDeleteDay,
        day: dayToDelete
      })
    )
  );
}


// =================================================================================
// RENDER TO DOM (original index.tsx)
// =================================================================================

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  React.createElement(React.StrictMode, null, 
    React.createElement(App)
  )
);
