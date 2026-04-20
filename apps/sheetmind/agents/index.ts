import { IAgentService } from '../types/agent';
import { SmartTranslateAgent } from './SmartTranslateAgent';
import { PromptToolAgent } from './PromptToolAgent';
import { ProfessionalClassifyAgent } from './ProfessionalClassifyAgent';
import { SemanticDedupAgent } from './SemanticDedupAgent';
import { SplitColumnAgent } from './SplitColumnAgent';

export const AgentRegistry: IAgentService[] = [
    SmartTranslateAgent,
    PromptToolAgent,
    ProfessionalClassifyAgent,
    SplitColumnAgent
];

export const getAgentById = (id: string): IAgentService | undefined => {
    if (id === 'agent_semantic_dedup') return SemanticDedupAgent;
    return AgentRegistry.find(a => a.id === id);
};
