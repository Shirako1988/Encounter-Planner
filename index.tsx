

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';

// =================================================================================
// TYPE DEFINITIONS (from types.ts)
// =================================================================================

interface Party {
  size: number;
  level: number;
}

interface Settings {
  budgetMultiplier: number;
  globalOverhangPercent: number;
}

interface Encounter {
  id: string;
  name: string;
  baseXp: number;
  count: number;
  localOverhangPercent: number | null;
}

interface Day {
  id: string;
  title: string;
  encounters: Encounter[];
}

// Represents the customizable XP table
type XpThresholdsTable = { [level: number]: { low: number; moderate: number; high: number } };

interface AppState {
  party: Party;
  settings: Settings;
  days: Day[];
  xpThresholdsTable: XpThresholdsTable;
}

interface SaveSlot {
    id: string;
    name: string;
    lastModified: number;
    appState: AppState;
}

interface SaveData {
    activeSlotId: string | null;
    saveSlots: SaveSlot[];
}


interface EncounterThresholds {
  trivial: number;
  easy: number;
  medium: number;
  hard: number;
  deadly: number;
}

type Theme = 'light' | 'dark' | 'auto';


// =================================================================================
// CONSTANTS (from constants.ts)
// =================================================================================

const XP_THRESHOLDS_PER_LEVEL: XpThresholdsTable = {
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

const DIFFICULTY_COLORS: { [key: string]: string } = {
    trivial: 'bg-slate-500',
    easy: 'bg-sky-600',
    medium: 'bg-green-600',
    hard: 'bg-amber-600',
    deadly: 'bg-red-700',
    unknown: 'bg-slate-700',
};

const DIFFICULTY_TEXT_COLORS: { [key: string]: string } = {
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

const calculateEncounterThresholds = (party: Party, multiplier: number, xpTable: XpThresholdsTable): EncounterThresholds => {
  const t = xpTable[party.level];
  if (!t) return { trivial: 0, easy: 0, medium: 0, hard: 0, deadly: 0 };

  return {
    trivial: Math.round(t.low * 0.5 * party.size * multiplier),
    easy: Math.round(t.low * party.size * multiplier),
    medium: Math.round(t.moderate * party.size * multiplier),
    hard: Math.round(t.high * party.size * multiplier),
    deadly: Math.round(t.high * 1.5 * party.size * multiplier),
  };
};

const calculateDailyBudget = (party: Party, multiplier: number, xpTable: XpThresholdsTable): number => {
  const highXP = xpTable[party.level]?.high || 0;
  return Math.round(party.size * highXP * 3 * multiplier);
};

const calculateAdjustedXp = (baseXp: number, count: number, overhangPercent: number): number => {
  if (!baseXp || !count || count < 1) return 0;
  if (count >= 2) {
    const excess = count - 1; // Bonus applies from the second creature
    const bonus = baseXp * excess * (overhangPercent / 100);
    return Math.round(baseXp + bonus);
  }
  return baseXp;
};

const getEncounterDifficulty = (adjustedXp: number, thresholds: EncounterThresholds): { level: string; percentage: number; } => {
    if (thresholds.deadly === 0) return { level: 'unknown', percentage: 0 };

    let level: string;
    let percentage: number;

    if (adjustedXp <= thresholds.trivial) {
        percentage = (adjustedXp / thresholds.trivial) * 10;
        level = 'trivial';
    } else if (adjustedXp <= thresholds.easy) {
        percentage = 10 + ((adjustedXp - thresholds.trivial) / (thresholds.easy - thresholds.trivial)) * 20;
        level = 'easy';
    } else if (adjustedXp <= thresholds.medium) {
        percentage = 30 + ((adjustedXp - thresholds.easy) / (thresholds.medium - thresholds.easy)) * 20;
        level = 'medium';
    } else if (adjustedXp <= thresholds.hard) {
        percentage = 50 + ((adjustedXp - thresholds.medium) / (thresholds.hard - thresholds.medium)) * 20;
        level = 'hard';
    } else if (adjustedXp <= thresholds.deadly) {
        percentage = 70 + ((adjustedXp - thresholds.hard) / (thresholds.deadly - thresholds.hard)) * 20;
        level = 'deadly';
    } else {
        percentage = Math.min(100, 90 + ((adjustedXp - thresholds.deadly) / thresholds.deadly) * 10);
        level = 'deadly';
    }
    
    return { level, percentage: Math.max(0, Math.min(100, percentage)) };
};

// =================================================================================
// HOOKS (from hooks/useUndoRedo.ts)
// =================================================================================

type UndoRedoReturn<T> = [
  T,
  (newState: T, fromHistory?: boolean) => void,
  () => void,
  () => void,
  boolean,
  boolean
];

const useUndoRedo = <T,>(initialState: T): UndoRedoReturn<T> => {
  const [history, setHistory] = useState<{ past: T[], present: T, future: T[] }>({
    past: [],
    present: initialState,
    future: [],
  });

  const { past, present, future } = history;
  const canUndo = past.length > 0;
  const canRedo = future.length > 0;

  const setState = useCallback((newState: T, fromHistory = false) => {
    if (fromHistory) {
      setHistory(currentHistory => ({...currentHistory, present: newState}));
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

const NumberInput: React.FC<React.InputHTMLAttributes<HTMLInputElement> & {isEncounter?: boolean}> = ({ isEncounter = false, ...props }) => (
  <input
    type="number"
    className={`w-full bg-[#eee3cf] dark:bg-[#2f2f2f] text-[#4a2e1a] dark:text-[#d4c8b0] border-2 border-[#d1c7b8] dark:border-[#4a4a4a] text-base focus:outline-none focus:border-[#c99a4e] transition ${isEncounter ? 'px-2 py-1.5 rounded' : 'px-3 py-2 rounded'}`}
    {...props}
  />
);

const FormGroup: React.FC<{ label: string; title?: string; children: React.ReactNode; isEncounter?: boolean }> = ({ label, title, children, isEncounter = false }) => (
    <div className={isEncounter ? "flex-1 min-w-[60px]" : "flex-1"}>
      <label className={`block font-bold text-[#6d4f33] dark:text-[#a38b6d] ${isEncounter ? 'text-sm mb-1' : 'text-base mb-2'}`} title={title}>{label}</label>
      {children}
    </div>
);

const Panel: React.FC<{ children: React.ReactNode, className?: string }> = ({ children, className = '' }) => (
  <div className={`bg-[#f3eadd] border-2 border-[#d1c7b8] dark:bg-[#2a2a2a] dark:border-[#4a4a4a] p-5 rounded-none shadow-md ${className}`}>
    {children}
  </div>
);

const FormRow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex gap-3 items-end">{children}</div>
);

const RangeInput: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = (props) => (
  <input
    type="range"
    className="w-full h-2 bg-[#d1c7b8] dark:bg-[#4a4a4a] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#c99a4e]"
    {...props}
  />
);

const DragHandleIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="12" r="1"></circle><circle cx="9" cy="5" r="1"></circle><circle cx="9" cy="19" r="1"></circle>
        <circle cx="15" cy="12" r="1"></circle><circle cx="15" cy="5" r="1"></circle><circle cx="15" cy="19" r="1"></circle>
    </svg>
);

const UndoIcon = () => ( <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path fillRule="evenodd" d="M8 3a5 5 0 1 1-4.546 2.914.5.5 0 0 0-.908-.417A6 6 0 1 0 8 2z"/><path d="M8 4.466V.534a.25.25 0 0 0-.41-.192L5.23 2.308a.25.25 0 0 0 0 .384l2.36 1.966A.25.25 0 0 0 8 4.466"/></svg> );
const RedoIcon = () => ( <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path fillRule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2z"/><path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966a.25.25 0 0 1 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466"/></svg> );
const SunIcon = () => ( <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M8 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6m0 1a4 4 0 1 0 0-8 4 4 0 0 0 0 8M8 0a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 0m0 13a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 13m-5-4a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 0 1h-2a.5.5 0 0 1-.5-.5M11 .5a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2a.5.5 0 0 1 .5-.5m-2.657 1.621a.5.5 0 0 1 .707 0l1.414 1.414a.5.5 0 0 1-.707.707L8.343 2.828a.5.5 0 0 1 0-.707m-4.95 4.95a.5.5 0 0 1 0 .707L2.828 8.343a.5.5 0 0 1-.707-.707l1.414-1.414a.5.5 0 0 1 .707 0zm4.95 4.95a.5.5 0 0 1 .707 0l1.414 1.414a.5.5 0 0 1-.707.707l-1.414-1.414a.5.5 0 0 1 0-.707M1.621 11.657a.5.5 0 0 1 0 .707l1.414 1.414a.5.5 0 0 1-.707.707l-1.414-1.414a.5.5 0 0 1 .707-.707M13 8a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 0 1h-2A.5.5 0 0 1 13 8"/></svg> );
const MoonIcon = () => ( <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M6 .278a.77.77 0 0 1 .08.858 7.2 7.2 0 0 0-1.023 7.925 7.2 7.2 0 0 0 7.925-1.023.77.77 0 0 1 .858.08.77.77 0 0 1 .387.653A6.5 6.5 0 0 1 9.5 16 6.5 6.5 0 0 1 3 9.5a6.5 6.5 0 0 1 2.625-5.053.77.77 0 0 1 .653.387z"/></svg> );
const SystemIcon = () => ( <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M12 1.5a.5.5 0 0 1 .5.5v11a.5.5 0 0 1-1 0v-11a.5.5 0 0 1 .5-.5M3.5 1a.5.5 0 0 0-.5.5v13a.5.5 0 0 0 1 0V1.5a.5.5 0 0 0-.5-.5M1.5 4a.5.5 0 0 0-.5.5v8a.5.5 0 0 0 1 0v-8a.5.5 0 0 0-.5-.5m13 0a.5.5 0 0 0-.5.5v8a.5.5 0 0 0 1 0v-8a.5.5 0 0 0-.5-.5M7 14a1 1 0 1 0 0-2 1 1 0 0 0 0 2"/></svg> );
const SaveIcon = () => ( <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M2 1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H9.5a1 1 0 0 0-1 1v4.5h2a.5.5 0 0 1 .354.854l-2.5 2.5a.5.5 0 0 1-.708 0l-2.5-2.5A.5.5 0 0 1 5.5 6.5h2V2a2 2 0 0 1 2-2H14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h2.5a.5.5 0 0 1 0 1z"/></svg> );


// =================================================================================
// COMPONENTS (from components folder)
// =================================================================================

// --- ConfirmDeleteModal (New Component) ---
interface ConfirmDeleteModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    slotName: string;
}

const ConfirmDeleteModal: React.FC<ConfirmDeleteModalProps> = ({ isOpen, onClose, onConfirm, slotName }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-[#f3eadd] dark:bg-[#2a2a2a] border-4 border-[#d1c7b8] dark:border-[#4a4a4a] w-full max-w-md flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
                <header className="flex justify-between items-center p-4 border-b-4 border-red-800/40">
                    <h2 className="text-2xl font-bold font-medieval text-red-800 dark:text-red-500">Löschen Bestätigen</h2>
                    <button onClick={onClose} className="text-3xl font-bold text-[#6d4f33] dark:text-[#a38b6d] hover:text-red-700">&times;</button>
                </header>
                <div className="p-6 text-center">
                    <p className="text-lg text-[#6d4f33] dark:text-[#d4c8b0]">
                        Sind Sie sicher, dass Sie den Speicherstand <br />
                        <strong className="font-bold text-[#c99a4e]">{slotName}</strong> endgültig löschen möchten?
                    </p>
                    <p className="text-sm text-slate-500 mt-2">Diese Aktion kann nicht rückgängig gemacht werden.</p>
                </div>
                <footer className="flex justify-end gap-3 p-4 bg-[#eee3cf] dark:bg-[#2f2f2f]">
                    <button onClick={onClose} className="bg-transparent border-2 border-slate-500 text-slate-600 dark:text-slate-400 font-bold py-2 px-6 rounded-sm transition-colors hover:bg-slate-500/20">
                        Abbrechen
                    </button>
                    <button onClick={onConfirm} className="bg-red-800 text-white font-bold py-2 px-6 rounded-sm transition-transform hover:scale-105 border-2 border-red-900">
                        Löschen
                    </button>
                </footer>
            </div>
        </div>
    );
};

// --- SaveManagerModal ---
interface SaveManagerModalProps {
    isOpen: boolean;
    onClose: () => void;
    saveData: SaveData;
    onLoad: (slotId: string) => void;
    onSaveNew: () => void;
    onDelete: (slotId: string) => void;
    onRename: (slotId: string, newName: string) => void;
    onCopy: (slotId: string) => void;
    onExport: (slotId: string) => void;
    onImport: (file: File) => void;
    renamingId: string | null;
    setRenamingId: (id: string | null) => void;
}
const SaveManagerModal: React.FC<SaveManagerModalProps> = ({ isOpen, onClose, saveData, onLoad, onSaveNew, onDelete, onRename, onCopy, onExport, onImport, renamingId, setRenamingId }) => {
    const [newName, setNewName] = useState("");
    const importInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (renamingId) {
            const slotToRename = saveData.saveSlots.find(s => s.id === renamingId);
            if (slotToRename) {
                setNewName(slotToRename.name);
            }
        }
    }, [renamingId, saveData.saveSlots]);

    if (!isOpen) return null;

    const handleRename = (slot: SaveSlot) => {
        setRenamingId(slot.id);
        setNewName(slot.name);
    };
    
    const handleRenameSubmit = (slotId: string) => {
        if (newName.trim()) {
            onRename(slotId, newName.trim());
        }
        setRenamingId(null);
    };
    
    const handleImportClick = () => {
        importInputRef.current?.click();
    };

    const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            onImport(file);
        }
        e.target.value = ''; // Reset for re-importing same file
    };

    return (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-[#f3eadd] dark:bg-[#2a2a2a] border-4 border-[#d1c7b8] dark:border-[#4a4a4a] w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
                <header className="flex justify-between items-center p-4 border-b-4 border-[#c99a4e]/40">
                    <h2 className="text-2xl font-bold font-medieval text-[#c99a4e]">Speicherstände Verwalten</h2>
                    <button onClick={onClose} className="text-3xl font-bold text-[#6d4f33] dark:text-[#a38b6d] hover:text-[#c99a4e]">&times;</button>
                </header>

                <div className="p-4 overflow-y-auto">
                    <div className="grid grid-cols-2 gap-3 mb-4">
                        <button onClick={onSaveNew} className="w-full bg-transparent border-2 border-[#c99a4e]/50 text-[#c99a4e] font-bold py-2.5 px-4 rounded-sm transition-colors hover:bg-[#c99a4e]/20">
                            + Neuer Speicherstand
                        </button>
                        <button onClick={handleImportClick} className="w-full bg-transparent border-2 border-[#c99a4e]/50 text-[#c99a4e] font-bold py-2.5 px-4 rounded-sm transition-colors hover:bg-[#c99a4e]/20">
                            Importieren...
                        </button>
                        <input type="file" accept=".json" ref={importInputRef} onChange={handleFileImport} className="hidden" />
                    </div>

                    <div className="space-y-2">
                        {saveData.saveSlots.map(slot => (
                            <div key={slot.id} className={`p-3 flex flex-col sm:flex-row sm:items-center gap-3 border-2 ${slot.id === saveData.activeSlotId ? 'bg-[#c99a4e]/20 border-[#c99a4e]' : 'bg-[#eee3cf] dark:bg-[#2f2f2f] border-[#d1c7b8] dark:border-[#4a4a4a]'}`}>
                                <div className="flex-1">
                                    {renamingId === slot.id ? (
                                        <input
                                            type="text"
                                            value={newName}
                                            onChange={e => setNewName(e.target.value)}
                                            onBlur={() => handleRenameSubmit(slot.id)}
                                            onKeyDown={e => e.key === 'Enter' && handleRenameSubmit(slot.id)}
                                            className="bg-[#f3eadd] dark:bg-[#1a1a1a] px-2 py-1 border-2 border-[#c99a4e] w-full"
                                            autoFocus
                                        />
                                    ) : (
                                        <h3 className="font-bold text-lg text-[#6d4f33] dark:text-[#d4c8b0]">{slot.name}</h3>
                                    )}
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                        Zuletzt geändert: {new Date(slot.lastModified).toLocaleString()}
                                    </p>
                                </div>
                                <div className="flex flex-wrap gap-1.5 justify-start sm:justify-end">
                                    <button onClick={() => onLoad(slot.id)} disabled={slot.id === saveData.activeSlotId} className="bg-green-700 text-white px-2 py-1 text-xs font-bold rounded-sm disabled:bg-slate-500 disabled:cursor-not-allowed">Laden</button>
                                    <button onClick={() => handleRename(slot)} className="bg-sky-700 text-white px-2 py-1 text-xs font-bold rounded-sm">Umbenennen</button>
                                    <button onClick={() => onCopy(slot.id)} className="bg-blue-700 text-white px-2 py-1 text-xs font-bold rounded-sm">Kopieren</button>
                                    <button onClick={() => onExport(slot.id)} className="bg-amber-600 text-white px-2 py-1 text-xs font-bold rounded-sm">Export</button>
                                    <button onClick={() => onDelete(slot.id)} className="bg-red-800 text-white px-2 py-1 text-xs font-bold rounded-sm">Löschen</button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};


// --- ThemeSwitcher ---
interface ThemeSwitcherProps {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}
const ThemeSwitcher: React.FC<ThemeSwitcherProps> = ({ theme, setTheme }) => {
  const options: { value: Theme, icon: React.ReactNode }[] = [
    { value: 'auto', icon: <SystemIcon /> },
    { value: 'light', icon: <SunIcon /> },
    { value: 'dark', icon: <MoonIcon /> },
  ];
  return (
    <div className="flex bg-[#d1c7b8] dark:bg-[#4a4a4a] rounded-md p-0.5 border-2 border-[#b8ab98] dark:border-[#5a5a5a]">
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => setTheme(opt.value)}
          title={`Set theme to ${opt.value}`}
          className={`px-2 py-1 rounded-sm transition-colors text-lg ${
            theme === opt.value
              ? 'bg-[#f3eadd] dark:bg-[#2a2a2a] text-[#c99a4e]'
              : 'text-[#6d4f33] dark:text-[#a38b6d] hover:bg-white/50 dark:hover:bg-black/20'
          }`}
        >
          {opt.icon}
        </button>
      ))}
    </div>
  );
};

// --- XpMatrix ---
interface XpMatrixProps {
  level: number;
  xpTable: XpThresholdsTable;
  onUpdate: (level: number, key: 'low' | 'moderate' | 'high', value: number) => void;
  onReset: (level: number) => void;
}

const XpMatrix: React.FC<XpMatrixProps> = ({ level, xpTable, onUpdate, onReset }) => {
  const currentLevelThresholds = xpTable[level] || { low: 0, moderate: 0, high: 0 };

  const handleUpdate = (key: 'low' | 'moderate' | 'high', value: string) => {
    onUpdate(level, key, parseInt(value) || 0);
  };

  return (
    <Panel>
      <div className="flex justify-between items-center mb-3">
        <h4 className="m-0 text-xl font-bold text-[#c99a4e] font-medieval">XP Matrix</h4>
        <button 
          onClick={() => onReset(level)}
          className="bg-transparent border-2 border-[#c99a4e]/50 text-[#c99a4e] text-xs font-bold py-1 px-2.5 rounded transition-colors hover:bg-[#c99a4e]/20"
        >
          Reset Level {level}
        </button>
      </div>
      <div className="space-y-2 text-base">
        <FormRow>
          <div className="w-24 shrink-0 font-bold text-[#6d4f33] dark:text-[#a38b6d]">Easy</div>
          <NumberInput 
            value={currentLevelThresholds.low} 
            onChange={e => handleUpdate('low', e.target.value)}
          />
        </FormRow>
        <FormRow>
          <div className="w-24 shrink-0 font-bold text-[#6d4f33] dark:text-[#a38b6d]">Medium</div>
          <NumberInput 
            value={currentLevelThresholds.moderate} 
            onChange={e => handleUpdate('moderate', e.target.value)}
          />
        </FormRow>
        <FormRow>
          <div className="w-24 shrink-0 font-bold text-[#6d4f33] dark:text-[#a38b6d]">Hard</div>
          <NumberInput 
            value={currentLevelThresholds.high} 
            onChange={e => handleUpdate('high', e.target.value)}
          />
        </FormRow>
      </div>
    </Panel>
  );
};


// --- EncounterCard.tsx ---
interface EncounterCardProps {
  encounter: Encounter;
  globalOverhangPercent: number;
  encounterThresholds: EncounterThresholds;
  onUpdate: (updatedEncounter: Partial<Encounter>) => void;
  onDelete: () => void;
  isDragging: boolean;
  isDropTargetBefore: boolean;
  isDropTargetAfter: boolean;
  onDragStart: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: (e: React.DragEvent<HTMLDivElement>) => void;
}

const EncounterCard: React.FC<EncounterCardProps> = ({
  encounter,
  globalOverhangPercent,
  encounterThresholds,
  onUpdate,
  onDelete,
  isDragging,
  isDropTargetBefore,
  isDropTargetAfter,
  ...dragProps
}) => {
  const overhangPercent = encounter.localOverhangPercent ?? globalOverhangPercent;
  
  const adjustedXp = useMemo(() => 
    calculateAdjustedXp(encounter.baseXp, encounter.count, overhangPercent),
    [encounter.baseXp, encounter.count, overhangPercent]
  );
  
  const difficulty = useMemo(() =>
    getEncounterDifficulty(adjustedXp, encounterThresholds),
    [adjustedXp, encounterThresholds]
  );

  return (
    <div
      draggable
      {...dragProps}
      className={`relative bg-[#eee3cf] dark:bg-[#2f2f2f] border-2 border-[#d1c7b8] dark:border-[#4a4a4a] p-3 flex flex-col gap-2 transition-all duration-300 ${isDragging ? 'opacity-50 scale-105 shadow-lg shadow-[#c99a4e]/50' : 'opacity-100'}`}
    >
      {isDropTargetBefore && <div className="absolute top-0 bottom-0 -left-1 w-1 bg-sky-500 rounded-full z-10 pointer-events-none" />}
      {isDropTargetAfter && <div className="absolute top-0 bottom-0 -right-1 w-1 bg-sky-500 rounded-full z-10 pointer-events-none" />}

      <div 
          className="absolute top-2 left-1.5 p-1 cursor-grab text-[#6d4f33] dark:text-[#a38b6d] hover:text-[#c99a4e] hover:bg-[#c99a4e]/10 rounded hidden sm:block"
          title="Drag to reorder"
      >
          <DragHandleIcon />
      </div>

      <header className="flex justify-between items-center gap-2 sm:ml-8">
        <input
          type="text"
          value={encounter.name}
          onChange={e => onUpdate({ name: e.target.value })}
          className="bg-transparent border-b-2 border-[#d1c7b8] dark:border-[#4a4a4a] px-2 py-1.5 text-lg font-bold w-full focus:outline-none focus:border-[#c99a4e]"
          placeholder="Encounter Name"
        />
        <button onClick={onDelete} className="bg-transparent border-2 border-red-800/50 text-red-700 dark:text-red-500 text-sm font-bold py-1 px-2.5 rounded-sm shrink-0 transition-colors hover:bg-red-800/20">×</button>
      </header>
      
      <div className="flex flex-wrap gap-2 items-end sm:ml-8">
        <FormGroup label="Base XP" isEncounter>
          <NumberInput isEncounter min="0" value={encounter.baseXp} onChange={e => onUpdate({ baseXp: parseInt(e.target.value) || 0 })} />
        </FormGroup>
        <FormGroup label="Count" isEncounter>
          <NumberInput isEncounter min="1" value={encounter.count} onChange={e => onUpdate({ count: parseInt(e.target.value) || 1 })} />
        </FormGroup>
        <FormGroup label="Overhang %" title="Leave empty to use global setting" isEncounter>
          <NumberInput 
            isEncounter
            min="0" max="999" 
            value={encounter.localOverhangPercent ?? ''} 
            onChange={e => onUpdate({ localOverhangPercent: e.target.value === '' ? null : parseInt(e.target.value) })}
            placeholder={globalOverhangPercent.toString()} 
          />
        </FormGroup>
        <FormGroup label="Adjusted XP" isEncounter>
          <div className="h-[38px] flex items-center justify-center text-base font-bold text-[#c99a4e] bg-[#c99a4e]/10 border-2 border-[#c99a4e]/30 rounded px-2 py-1.5">
            {adjustedXp.toLocaleString()}
          </div>
        </FormGroup>
      </div>

      <div className="flex items-center gap-2 mt-1 sm:ml-8">
        <div className="flex-1 h-2.5 bg-[#d1c7b8] dark:bg-[#1a1a1a] rounded-full overflow-hidden relative border-2 border-[#b8ab98] dark:border-[#4a4a4a]">
          <div 
            className={`h-full rounded-full transition-all duration-300 ${DIFFICULTY_COLORS[difficulty.level]}`}
            style={{ width: `${difficulty.percentage}%` }}
          ></div>
          <div className="absolute inset-0 flex pointer-events-none">
            {[...Array(5)].map((_, i) => <div key={i} className="flex-1 border-r-2 border-[#d1c7b8]/50 dark:border-[#4a4a4a]/50 last:border-r-0"></div>)}
          </div>
        </div>
        <div className={`w-14 text-center text-sm font-bold uppercase tracking-wider ${DIFFICULTY_TEXT_COLORS[difficulty.level]}`}>
          {difficulty.level}
        </div>
      </div>
    </div>
  );
};


// --- AdventuringDay.tsx ---
interface AdventuringDayProps {
  day: Day;
  dailyBudget: number;
  globalOverhangPercent: number;
  encounterThresholds: EncounterThresholds;
  onUpdateDay: (dayId: string, updatedDay: Partial<Day>) => void;
  onDeleteDay: (dayId: string) => void;
  onAddEncounter: (dayId: string) => void;
  onDeleteEncounter: (dayId: string, encounterId: string) => void;
  onUpdateEncounter: (dayId: string, encounterId: string, updatedEncounter: Partial<Encounter>) => void;
  onReorderEncounters: (dayId: string, sourceIndex: number, destIndex: number) => void;
}

const AdventuringDay: React.FC<AdventuringDayProps> = ({
  day,
  dailyBudget,
  globalOverhangPercent,
  encounterThresholds,
  onUpdateDay,
  onDeleteDay,
  onAddEncounter,
  onDeleteEncounter,
  onUpdateEncounter,
  onReorderEncounters
}) => {
  const [draggedItemIndex, setDraggedItemIndex] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{ index: number; position: 'before' | 'after' } | null>(null);
  
  const totalUsedXp = useMemo(() => {
    return day.encounters.reduce((total, enc) => {
      const overhang = enc.localOverhangPercent ?? globalOverhangPercent;
      return total + calculateAdjustedXp(enc.baseXp, enc.count, overhang);
    }, 0);
  }, [day.encounters, globalOverhangPercent]);
  
  const remainingXp = dailyBudget - totalUsedXp;

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, index: number) => {
    setDraggedItemIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };
  
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>, index: number) => {
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

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
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
    <div className="bg-[#f3eadd] dark:bg-[#2a2a2a]/70 border-4 border-[#d1c7b8] dark:border-[#4a4a4a] p-5 shadow-lg">
      <header className="flex justify-between items-center gap-4 pb-3 mb-4 border-b-4 border-[#c99a4e]/40">
        <input
          type="text"
          value={day.title}
          onChange={e => onUpdateDay(day.id, { title: e.target.value })}
          className="bg-transparent text-2xl font-bold w-full focus:outline-none font-medieval"
          placeholder={`Adventuring Day ${day.id}`}
        />
        <button onClick={() => onDeleteDay(day.id)} className="bg-red-800 text-[#f3eadd] font-bold py-2 px-4 rounded-sm shrink-0 transition-transform hover:scale-105 border-2 border-red-900">
          Delete Day
        </button>
      </header>
      
      <button onClick={() => onAddEncounter(day.id)} className="w-full bg-transparent border-2 border-[#c99a4e]/50 text-[#c99a4e] font-bold py-2.5 px-4 rounded-sm mb-3 transition-colors hover:bg-[#c99a4e]/20">
        + Add Encounter
      </button>

      <div className={`grid gap-3 ${gridColsClass}`}>
        {day.encounters.map((encounter, index) => (
          <EncounterCard
            key={encounter.id}
            encounter={encounter}
            globalOverhangPercent={globalOverhangPercent}
            encounterThresholds={encounterThresholds}
            onUpdate={updatedEncounter => onUpdateEncounter(day.id, encounter.id, updatedEncounter)}
            onDelete={() => onDeleteEncounter(day.id, encounter.id)}
            isDragging={draggedItemIndex === index}
            isDropTargetBefore={dropTarget?.index === index && dropTarget.position === 'before'}
            isDropTargetAfter={dropTarget?.index === index && dropTarget.position === 'after'}
            onDragStart={(e) => handleDragStart(e, index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
          />
        ))}
      </div>

      <footer className="mt-4 pt-3 border-t-2 border-black/10 dark:border-white/10 flex justify-between items-center font-bold text-lg">
        <span>Used XP: <span className="text-[#c99a4e]">{totalUsedXp.toLocaleString()}</span></span>
        <span>Remaining: <span className={remainingXp >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-500'}>{remainingXp.toLocaleString()}</span></span>
      </footer>
    </div>
  );
};


// --- PartySetup.tsx ---
interface PartySetupProps {
  party: Party;
  settings: Settings;
  dailyBudget: number;
  encounterThresholds: EncounterThresholds;
  xpTable: XpThresholdsTable;
  onPartyChange: (newParty: Partial<Party>) => void;
  onSettingsChange: (newSettings: Partial<Settings>) => void;
  onXpTableUpdate: (level: number, key: 'low' | 'moderate' | 'high', value: number) => void;
  onXpTableReset: (level: number) => void;
}

const PartySetup: React.FC<PartySetupProps> = ({ party, settings, dailyBudget, encounterThresholds, xpTable, onPartyChange, onSettingsChange, onXpTableUpdate, onXpTableReset }) => {
  const { trivial, easy, medium, hard, deadly } = encounterThresholds;
  const baseThresholds = xpTable[party.level];
  const baseDailyPerPlayer = baseThresholds ? baseThresholds.high * 3 : 0;
  
  return (
    <>
      <Panel>
        <h3 className="m-0 mb-4 text-2xl font-bold text-[#c99a4e] font-medieval">Party Setup</h3>
        <FormRow>
          <FormGroup label="Anzahl Spieler">
            <NumberInput min="1" max="10" value={party.size} onChange={e => onPartyChange({ size: parseInt(e.target.value) || 1 })} />
          </FormGroup>
          <FormGroup label="Party Level">
            <NumberInput min="1" max="20" value={party.level} onChange={e => onPartyChange({ level: parseInt(e.target.value) || 1 })} />
          </FormGroup>
        </FormRow>

        <div className="mt-6">
          <label className="block text-base font-bold text-[#6d4f33] dark:text-[#a38b6d] mb-2">Budget Multiplier</label>
          <div className="flex items-center gap-3">
            <RangeInput
              min="0.5" max="2" step="0.05"
              value={settings.budgetMultiplier}
              onChange={e => onSettingsChange({ budgetMultiplier: parseFloat(e.target.value) })}
            />
            <span className="min-w-[45px] text-center font-bold text-lg text-[#c99a4e]">{settings.budgetMultiplier.toFixed(2)}</span>
          </div>
        </div>

        <div className="mt-6">
          <label className="block text-base font-bold text-[#6d4f33] dark:text-[#a38b6d] mb-2">Overhang Bonus %</label>
          <div className="flex items-center gap-3">
            <RangeInput
              min="0" max="10" step="1"
              value={settings.globalOverhangPercent}
              onChange={e => onSettingsChange({ globalOverhangPercent: parseInt(e.target.value) })}
            />
            <span className="min-w-[45px] text-center font-bold text-lg text-[#c99a4e]">{settings.globalOverhangPercent}%</span>
          </div>
        </div>
        
        <div className="bg-[#c99a4e]/10 p-4 mt-6 border-2 border-[#c99a4e]/30 text-center font-bold text-xl text-[#c99a4e]">
          Daily XP Budget: {dailyBudget.toLocaleString()} XP
        </div>
      </Panel>
      <Panel>
          <h4 className="m-0 mb-3 text-xl font-bold text-[#c99a4e] font-medieval">XP Information</h4>
          <div className="text-base space-y-3">
              <div className="leading-relaxed">
                  <strong className="text-[#6d4f33] dark:text-[#a38b6d]">Budget/Player:</strong><br/>
                  <span className="text-slate-700 dark:text-slate-400">{baseDailyPerPlayer.toLocaleString()} XP</span>
                  {settings.budgetMultiplier !== 1 && ` → `}
                  {settings.budgetMultiplier !== 1 && <span className="text-[#c99a4e] font-bold">{(baseDailyPerPlayer * settings.budgetMultiplier).toLocaleString()} XP</span>}
              </div>
              <div className="leading-relaxed">
                <strong className="text-[#6d4f33] dark:text-[#a38b6d]">Encounter Difficulties:</strong><br/>
                <span className="text-slate-500">◼ Trivial:</span> &lt; {trivial.toLocaleString()} XP<br/>
                <span className="text-sky-600 dark:text-sky-400">◼ Easy:</span> {easy.toLocaleString()} XP<br/>
                <span className="text-green-700 dark:text-green-400">◼ Medium:</span> {medium.toLocaleString()} XP<br/>
                <span className="text-amber-700 dark:text-amber-400">◼ Hard:</span> {hard.toLocaleString()} XP<br/>
                <span className="text-red-800 dark:text-red-500">◼ Deadly:</span> {deadly.toLocaleString()}+ XP
              </div>
          </div>
      </Panel>
      <XpMatrix 
        level={party.level}
        xpTable={xpTable}
        onUpdate={onXpTableUpdate}
        onReset={onXpTableReset}
      />
    </>
  );
};


// =================================================================================
// MAIN APP COMPONENT (from App.tsx)
// =================================================================================

const initialAppState: AppState = {
  party: { size: 4, level: 1 },
  settings: { budgetMultiplier: 1.0, globalOverhangPercent: 10 },
  days: [],
  xpThresholdsTable: XP_THRESHOLDS_PER_LEVEL,
};

const createNewSaveSlot = (appState: AppState, name: string): SaveSlot => ({
    id: crypto.randomUUID(),
    name,
    lastModified: Date.now(),
    appState,
});

const loadSaveData = (): SaveData => {
  try {
    const serializedData = localStorage.getItem('dndPlannerSaveData');
    if (serializedData) {
      const data: SaveData = JSON.parse(serializedData);
      if (data && Array.isArray(data.saveSlots)) {
        return data;
      }
    }
    
    // Migration from old single-state format
    const oldSerializedState = localStorage.getItem('dndPlannerState');
    if (oldSerializedState) {
        const oldState = JSON.parse(oldSerializedState);
        if (oldState.party && oldState.settings && Array.isArray(oldState.days)) {
            const migratedState: AppState = {
                ...initialAppState,
                ...oldState,
                xpThresholdsTable: oldState.xpThresholdsTable || initialAppState.xpThresholdsTable,
            };
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
  const [saveData, setSaveData] = useState<SaveData>(loadSaveData);
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [slotToDelete, setSlotToDelete] = useState<SaveSlot | null>(null);
  const [renamingSlotId, setRenamingSlotId] = useState<string | null>(null);

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
  ] = useUndoRedo<AppState>(activeAppState);
  
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('theme') as Theme) || 'auto');

  // Load new state into undo/redo hook when active slot changes
  useEffect(() => {
    setState(activeAppState, true);
  }, [activeAppState, setState]);

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

  // Save updated state to the active slot in localStorage
  useEffect(() => {
    if (!saveData.activeSlotId) return;
    const updatedSaveData = {
        ...saveData,
        saveSlots: saveData.saveSlots.map(slot => 
            slot.id === saveData.activeSlotId 
            ? { ...slot, appState: state, lastModified: Date.now() }
            : slot
        )
    };
    try {
      localStorage.setItem('dndPlannerSaveData', JSON.stringify(updatedSaveData));
    } catch (error) {
      console.error("Error saving state to localStorage:", error);
    }
  }, [state, saveData]);

  const dailyBudget = useMemo(() => calculateDailyBudget(party, settings.budgetMultiplier, xpThresholdsTable), [party, settings.budgetMultiplier, xpThresholdsTable]);
  const encounterThresholds = useMemo(() => calculateEncounterThresholds(party, settings.budgetMultiplier, xpThresholdsTable), [party, settings.budgetMultiplier, xpThresholdsTable]);

  const updateParty = useCallback((newParty: Partial<Party>) => {
    setState({ ...state, party: { ...party, ...newParty } });
  }, [state, setState]);

  const updateSettings = useCallback((newSettings: Partial<Settings>) => {
    setState({ ...state, settings: { ...settings, ...newSettings } });
  }, [state, setState]);

  const updateXpTable = useCallback((level: number, key: 'low' | 'moderate' | 'high', value: number) => {
    const newTable = {
      ...xpThresholdsTable,
      [level]: {
        ...xpThresholdsTable[level],
        [key]: value
      }
    };
    setState({ ...state, xpThresholdsTable: newTable });
  }, [state, setState]);

  const resetXpTableForLevel = useCallback((level: number) => {
    const newTable = {
      ...xpThresholdsTable,
      [level]: XP_THRESHOLDS_PER_LEVEL[level]
    };
    setState({ ...state, xpThresholdsTable: newTable });
  }, [state, setState]);

  const addDay = useCallback(() => {
    const newDay: Day = {
      id: crypto.randomUUID(),
      title: `Adventuring Day ${days.length + 1}`,
      encounters: [],
    };
    setState({ ...state, days: [...days, newDay] });
  }, [state, setState]);

  const deleteDay = useCallback((dayId: string) => {
    setState({ ...state, days: days.filter(d => d.id !== dayId) });
  }, [state, setState]);

  const updateDay = useCallback((dayId: string, updatedDay: Partial<Day>) => {
    setState({ ...state, days: days.map(d => d.id === dayId ? { ...d, ...updatedDay } : d) });
  }, [state, setState]);

  const addEncounter = useCallback((dayId: string) => {
    const day = days.find(d => d.id === dayId);
    if (!day) return;
    const newEncounter: Encounter = {
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

  const deleteEncounter = useCallback((dayId: string, encounterId: string) => {
    const newDays = days.map(d => {
      if (d.id === dayId) {
        return { ...d, encounters: d.encounters.filter(e => e.id !== encounterId) };
      }
      return d;
    });
    setState({ ...state, days: newDays });
  }, [state, setState]);

  const updateEncounter = useCallback((dayId: string, encounterId: string, updatedEncounter: Partial<Encounter>) => {
     const newDays = days.map(d => {
      if (d.id === dayId) {
        return { ...d, encounters: d.encounters.map(e => e.id === encounterId ? {...e, ...updatedEncounter} : e) };
      }
      return d;
    });
    setState({ ...state, days: newDays });
  }, [state, setState]);
  
  const reorderEncounters = useCallback((dayId: string, sourceIndex: number, destIndex: number) => {
    const day = days.find(d => d.id === dayId);
    if (!day) return;
    
    const reorderedEncounters = Array.from(day.encounters);
    const [removed] = reorderedEncounters.splice(sourceIndex, 1);
    reorderedEncounters.splice(destIndex, 0, removed);

    updateDay(dayId, { encounters: reorderedEncounters });
  }, [days, updateDay]);

  // Save Management Handlers
  const handleLoadSlot = (slotId: string) => {
    setSaveData(prev => ({ ...prev, activeSlotId: slotId }));
    setIsSaveModalOpen(false);
  };
  
  const handleSaveNewSlot = () => {
    const name = `Neuer Speicherstand ${saveData.saveSlots.length + 1}`;
    const newSlot = createNewSaveSlot(initialAppState, name);
    setSaveData(prev => ({
        ...prev,
        saveSlots: [...prev.saveSlots, newSlot],
    }));
    setRenamingSlotId(newSlot.id);
  };
  
  const handleRequestDelete = (slotId: string) => {
    const slot = saveData.saveSlots.find(s => s.id === slotId);
    if (slot) {
        setSlotToDelete(slot);
    }
  };

  const handleConfirmDelete = () => {
    if (!slotToDelete) return;
    setSaveData(prev => {
        const remainingSlots = prev.saveSlots.filter(s => s.id !== slotToDelete.id);
        let newActiveId = prev.activeSlotId;
        if (newActiveId === slotToDelete.id) {
            newActiveId = remainingSlots.length > 0 ? remainingSlots[0].id : null;
        }
        return { saveSlots: remainingSlots, activeSlotId: newActiveId };
    });
    setSlotToDelete(null);
  };

  const handleRenameSlot = (slotId: string, newName: string) => {
    setSaveData(prev => ({
        ...prev,
        saveSlots: prev.saveSlots.map(s => s.id === slotId ? { ...s, name: newName } : s)
    }));
  };
  
  const handleCopySlot = (slotId: string) => {
    const originalSlot = saveData.saveSlots.find(s => s.id === slotId);
    if (!originalSlot) return;
    const newSlot = createNewSaveSlot(originalSlot.appState, `Kopie von ${originalSlot.name}`);
    setSaveData(prev => ({
        ...prev,
        saveSlots: [...prev.saveSlots, newSlot]
    }));
  };

  const handleExportSlot = (slotId: string) => {
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

  const handleImportSlot = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const importedState = JSON.parse(event.target?.result as string) as AppState;
            // Basic validation
            if (importedState.party && importedState.settings && Array.isArray(importedState.days)) {
                const name = file.name.replace(/\.json$/, '');
                const newSlot = createNewSaveSlot(importedState, name);
                 setSaveData(prev => ({
                    ...prev,
                    saveSlots: [...prev.saveSlots, newSlot]
                }));
            } else {
                alert("Fehler: Die importierte Datei scheint kein gültiger Speicherstand zu sein.");
            }
        } catch (error) {
            alert("Fehler beim Lesen der Datei. Stellen Sie sicher, dass es sich um eine gültige JSON-Datei handelt.");
        }
    };
    reader.readAsText(file);
  };

  const AppButton: React.FC<{onClick: () => void, disabled?: boolean, children: React.ReactNode, title: string}> = ({onClick, disabled = false, children, title}) => (
    <button 
      onClick={onClick} 
      disabled={disabled} 
      title={title}
      className="bg-[#d1c7b8] dark:bg-[#4a4a4a] text-[#6d4f33] dark:text-[#a38b6d] font-bold p-2 rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors hover:enabled:bg-[#b8ab98] dark:hover:enabled:bg-[#5a5a5a] border-2 border-[#b8ab98] dark:border-[#5a5a5a]"
    >
      {children}
    </button>
  );

  const activeSlotName = useMemo(() => 
    saveData.saveSlots.find(s => s.id === saveData.activeSlotId)?.name,
    [saveData]
  );

  return (
    <div className="max-w-[1800px] min-h-[calc(100vh-48px)] mx-auto">
      <header className="flex justify-between items-start sm:items-center mb-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold text-[#6d4f33] dark:text-[#d4c8b0]">Encounter Planner</h1>
          {activeSlotName && (
            <p className="text-sm text-[#c99a4e] font-bold mt-1 tracking-wide">
              Aktiver Speicherstand: <span className="underline decoration-dotted">{activeSlotName}</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ThemeSwitcher theme={theme} setTheme={setTheme} />
          <AppButton onClick={() => setIsSaveModalOpen(true)} title="Speicherstände Verwalten"><SaveIcon /></AppButton>
          <AppButton onClick={undo} disabled={!canUndo} title="Undo"><UndoIcon /></AppButton>
          <AppButton onClick={redo} disabled={!canRedo} title="Redo"><RedoIcon /></AppButton>
        </div>
      </header>
      <main className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-6 items-start">
        <aside className="lg:sticky lg:top-6 flex flex-col gap-6">
          <PartySetup 
            party={party} 
            settings={settings}
            dailyBudget={dailyBudget}
            encounterThresholds={encounterThresholds}
            xpTable={xpThresholdsTable}
            onPartyChange={updateParty}
            onSettingsChange={updateSettings}
            onXpTableUpdate={updateXpTable}
            onXpTableReset={resetXpTableForLevel}
          />
        </aside>

        <section className="flex flex-col gap-4">
          <button onClick={addDay} className="w-full bg-[#c99a4e] text-[#f3eadd] font-bold py-3 px-4 rounded-sm text-lg transition-transform hover:scale-[1.02] border-2 border-[#ab813e] shadow-md">
            + Add Adventuring Day
          </button>
          <div className="flex flex-col gap-6">
            {days.map(day => (
              <AdventuringDay 
                key={day.id}
                day={day}
                dailyBudget={dailyBudget}
                globalOverhangPercent={settings.globalOverhangPercent}
                encounterThresholds={encounterThresholds}
                onUpdateDay={updateDay}
                onDeleteDay={deleteDay}
                onAddEncounter={addEncounter}
                onDeleteEncounter={deleteEncounter}
                onUpdateEncounter={updateEncounter}
                onReorderEncounters={reorderEncounters}
              />
            ))}
          </div>
        </section>
      </main>
      <SaveManagerModal 
        isOpen={isSaveModalOpen}
        onClose={() => {
            setIsSaveModalOpen(false);
            setRenamingSlotId(null);
        }}
        saveData={saveData}
        onLoad={handleLoadSlot}
        onSaveNew={handleSaveNewSlot}
        onDelete={handleRequestDelete}
        onRename={handleRenameSlot}
        onCopy={handleCopySlot}
        onExport={handleExportSlot}
        onImport={handleImportSlot}
        renamingId={renamingSlotId}
        setRenamingId={setRenamingSlotId}
      />
      <ConfirmDeleteModal 
        isOpen={!!slotToDelete}
        onClose={() => setSlotToDelete(null)}
        onConfirm={handleConfirmDelete}
        slotName={slotToDelete?.name || ''}
      />
    </div>
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
  <React.StrictMode>
    <App />
  </React.StrictMode>
);