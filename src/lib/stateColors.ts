import type { TimerDisplayState } from '@/types/firestore';
import { Clock4, ClockCheck, ClockAlert, Coffee, CirclePause } from 'lucide-react';
import type { ElementType } from 'react';

export type StateConfig = {
  color: string;
  bgAlpha: string;
  label: string;
  Icon: ElementType;
};

export const STATE_CONFIG: Record<TimerDisplayState, StateConfig> = {
  working:       { color: '#86C27E', bgAlpha: 'rgba(134,194,126,0.1)', label: 'Working',    Icon: ClockCheck  },
  idle:          { color: '#E37836', bgAlpha: 'rgba(227,120,54,0.1)',  label: 'Idle',        Icon: ClockAlert  },
  'on-break':    { color: '#4B8FCC', bgAlpha: 'rgba(75,143,204,0.1)', label: 'On Break',    Icon: Coffee      },
  paused:        { color: '#8B5CF6', bgAlpha: 'rgba(139,92,246,0.1)', label: 'Paused',      Icon: CirclePause },
  'clocked-out': { color: '#DF626E', bgAlpha: 'rgba(223,98,110,0.1)', label: 'Clocked Out', Icon: Clock4      },
};
