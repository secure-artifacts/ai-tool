import React from 'react';

/**
 * The configuration definition for a specific agent execution.
 */
export interface AgentTaskConfig {
  agentId: string;
  // Specific configuration options chosen by the user in the agent's Settings UI
  options: Record<string, any>;
  // The columns the agent will output
  outputColumns: string[];
}

/**
 * Universal interface for all standalone tools that can be invoked via DataPipeline
 */
export interface IAgentService {
  id: string;
  name: string;
  icon: React.ReactNode;
  description: string;

  /**
   * Render the configuration UI for this agent.
   * This is shown in a modal when the user selects this agent in DataPipeline.
   * `value` is the current user configuration. `onChange` saves it.
   */
  ConfigComponent: React.FC<{ 
    value: Record<string, any>; 
    onChange: (val: Record<string, any>) => void;
  }>;

  /**
   * Optional summary string to show in the pipeline UI to summarize chosen config
   */
  getSummary?: (config: Record<string, any>) => string;

  /**
   * Predict the output column names based on the user's config and the source column.
   * Example for Translation: source="Source Text", options={langs:['en', 'ja']} => ["Source Text_翻译_EN", "Source Text_翻译_JA"]
   * @param customName Optional user-provided custom name to replace or prefix the sourceCol
   */
  predictOutputColumns: (config: Record<string, any>, sourceCol: string, customName?: string) => string[];

  /**
   * Optional: Compile the agent's logic into a single natural language instruction 
   * so it can be safely merged into a unified LLM prompt.
   */
  compileMergedInstruction?: (config: Record<string, any>, sourceCol: string, outputCols: string[]) => string;

  /**
   * Execute the agent logic on a batch of data.
   * @param data Array of source strings mapping to the selected rows
   * @param config The options chosen by the user
   * @param getAiInstance a function to get GoogleGenAI instance for making API calls
   * @param sourceCol The source column name being processed
   * @param onProgress Optional progress callback
   * @param customName Optional user-provided custom name to replace or prefix the sourceCol
   * @returns Array of objects mapping outputColumn name to string value, aligned with input `data`
   */
  executeBatch: (
    data: string[], 
    config: Record<string, any>, 
    getAiInstance: () => any,
    sourceCol: string,
    onProgress?: (index: number, max: number) => void,
    customName?: string
  ) => Promise<Record<string, string>[]>;
}
