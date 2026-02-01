import React, { useContext, useEffect, useRef } from 'react';
import { AppContext } from '../AppContext';
import { SparklesIcon, MagicWandIcon, ChatIcon, ChevronUpIcon, ChevronDownIcon, SendIcon, TrashIcon } from './Icons';
import { PromptMode, ChatMessage } from '../AIImageEditorApp';

interface PromptBarProps {
  prompt: string;
  setPrompt: (prompt: string) => void;
  onGenerate: (prompt: string) => void;
  onSynthesize: (prompt: string) => void;
  canSynthesize: boolean;
  isGenerating: boolean;
  isSynthesizing: boolean;
  isLeftPanelOpen: boolean;
  isRightPanelCollapsed: boolean;
  promptMode: PromptMode;
  setPromptMode: (mode: PromptMode) => void;
  onExtractStyle: () => void;
  isExtractingStyle: boolean;
  isPromptExpanded: boolean;
  setIsPromptExpanded: (isExpanded: boolean) => void;
  chatHistory: ChatMessage[];
  chatInput: string;
  setChatInput: (input: string) => void;
  onSendChatMessage: () => void;
  onClearChatHistory: () => void;
  isReplying: boolean;
}

const ChatBubble: React.FC<{ message: ChatMessage }> = ({ message }) => {
  const { t } = useContext(AppContext);
  const isUser = message.role === 'user';
  return (
    <div className={`flex items-start gap-2.5 ${isUser ? 'justify-end' : ''}`}>
      <div className={`flex flex-col w-full max-w-[80%] leading-1.5 p-3 border-gray-200 rounded-xl ${isUser ? 'bg-indigo-500 text-white rounded-br-none' : 'bg-[var(--color-bg-contrast)] rounded-bl-none'}`}>
        <div className="flex items-center space-x-2 rtl:space-x-reverse mb-2">
          <span className="text-sm font-semibold">{isUser ? t('promptbar.role_user') : t('promptbar.role_model')}</span>
        </div>
        <p className="text-sm font-normal whitespace-pre-wrap">{message.text}</p>
      </div>
    </div>
  );
};

export const PromptBar: React.FC<PromptBarProps> = ({
  prompt, setPrompt, onGenerate, onSynthesize, canSynthesize,
  isGenerating, isSynthesizing, isLeftPanelOpen, isRightPanelCollapsed,
  promptMode, setPromptMode, onExtractStyle, isExtractingStyle,
  isPromptExpanded, setIsPromptExpanded, chatHistory, chatInput, setChatInput, onSendChatMessage, onClearChatHistory, isReplying
}) => {
  const { t } = useContext(AppContext);
  const isLoading = isGenerating || isSynthesizing || isExtractingStyle || isReplying;
  // 使用函数调用来避免 TypeScript 类型缩窄
  const getPromptMode = () => promptMode;
  const chatHistoryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatHistoryRef.current) {
      chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
    }
  }, [chatHistory]);

  const handleGenerateClick = () => {
    if (!isLoading) {
      onGenerate(prompt);
    }
  };

  const handleSynthesizeClick = () => {
    if (!isLoading && canSynthesize) {
      onSynthesize(prompt);
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (getPromptMode() === 'generate') {
        handleGenerateClick();
      } else {
        onSendChatMessage();
      }
    }
  };

  const leftPadding = (isLeftPanelOpen ? (64 + 256) : 64) + 16;
  const rightPadding = (!isRightPanelCollapsed ? 288 : 48) + 16;
  const promptAreaHeight = isPromptExpanded ? '480px' : 'auto';

  const editModeActions = (
    <div className="flex items-center gap-2" style={{ pointerEvents: isLoading ? 'none' : 'auto' }}>
      <div className="flex items-center bg-[var(--color-bg)] p-0.5 rounded-lg border border-[var(--color-border)]">
        <button
          onClick={() => setPromptMode('edit')}
          title={t('promptbar.mode_prompt')}
          className={`p-1.5 rounded-md transition-colors ${getPromptMode() === 'edit' ? 'bg-[var(--color-indigo)] text-white' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-contrast)]'}`}
        >
          <ChatIcon className="h-5 w-5" />
        </button>
        <button
          onClick={() => setPromptMode('generate')}
          title={t('promptbar.mode_generate')}
          className={`p-1.5 rounded-md transition-colors ${getPromptMode() === 'generate' ? 'bg-[var(--color-indigo)] text-white' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-contrast)]'}`}
        >
          <MagicWandIcon className="h-5 w-5" />
        </button>
      </div>
      <div className="h-8 w-px bg-[var(--color-border)]"></div>
      <button
        onClick={onExtractStyle}
        disabled={isLoading}
        className="px-3 py-2 bg-teal-600 hover:bg-teal-700 rounded-md text-sm font-semibold text-white transition-colors flex items-center gap-2 disabled:bg-gray-500 disabled:cursor-wait"
      >
        {isExtractingStyle && <div className="w-4 h-4 border-2 border-t-transparent border-white rounded-full animate-spin"></div>}
        <span>{t('promptbar.extract_style')}</span>
      </button>
    </div>
  );

  return (
    <div
      className="w-full py-4 z-10 bg-[var(--color-bg-tertiary)] border-t border-[var(--color-border)] flex-shrink-0"
      style={{
        paddingLeft: `${leftPadding}px`,
        paddingRight: `${rightPadding}px`,
        transition: 'padding-left 0.3s ease-in-out, padding-right 0.3s ease-in-out',
      }}
    >
      <div className="max-w-6xl mx-auto">
        <div className="relative">
          <div
            className="w-full bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg shadow-lg flex flex-col transition-[height] duration-300 ease-in-out"
            style={{ height: promptAreaHeight, minHeight: '64px' }}
          >
            {getPromptMode() === 'generate' ? (
              <textarea
                rows={1}
                className={`w-full h-full flex-grow bg-transparent p-4 pr-56 text-[var(--color-text-primary)] text-base focus:ring-2 focus:ring-[var(--color-indigo)] transition-all resize-none`}
                placeholder={t('promptbar.placeholder')}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isLoading}
                style={{ paddingTop: '20px' }}
              />
            ) : (
              <>
                {isPromptExpanded && (
                  <div className="flex-shrink-0 p-2 border-b border-[var(--color-border)] flex justify-between items-center">
                    <span className="text-sm font-semibold text-[var(--color-text-secondary)]">{t('promptbar.mode_prompt')}</span>
                    <button onClick={onClearChatHistory} title={t('promptbar.clear_chat')} className="p-1.5 rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-contrast)] hover:text-red-500">
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </div>
                )}
                <div ref={chatHistoryRef} className={`p-4 overflow-y-auto space-y-4 ${isPromptExpanded ? 'flex-grow' : chatHistory.length > 0 ? 'max-h-28' : 'hidden'}`}>
                  {chatHistory.map((msg, index) => <ChatBubble key={index} message={msg} />)}
                  {isReplying && (
                    <div className="flex items-start gap-2.5">
                      <div className="flex flex-col w-full max-w-[80%] leading-1.5 p-3 border-gray-200 rounded-xl bg-[var(--color-bg-contrast)] rounded-bl-none">
                        <div className="flex items-center space-x-2 rtl:space-x-reverse mb-2">
                          <span className="text-sm font-semibold">{t('promptbar.role_model')}</span>
                        </div>
                        <div className="flex items-center space-x-2">
                          <div className="w-2 h-2 bg-indigo-400 rounded-full animate-pulse"></div>
                          <div className="w-2 h-2 bg-indigo-400 rounded-full animate-pulse delay-75"></div>
                          <div className="w-2 h-2 bg-indigo-400 rounded-full animate-pulse delay-150"></div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex-shrink-0 p-2 border-t border-[var(--color-border)]">
                  {isPromptExpanded ? (
                    <div className="relative">
                      <textarea
                        rows={1}
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        disabled={isLoading}
                        placeholder={t('promptbar.chat_placeholder')}
                        className="w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg p-2 pr-12 text-sm resize-none"
                      />
                      <button
                        onClick={onSendChatMessage}
                        disabled={isLoading || !chatInput.trim()}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-[var(--color-indigo)] text-white hover:bg-[var(--color-indigo-hover)] disabled:bg-gray-500 disabled:cursor-not-allowed">
                        <SendIcon className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <textarea
                        rows={1}
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        disabled={isLoading}
                        placeholder={t('promptbar.chat_placeholder')}
                        className="flex-grow bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg p-2 text-sm resize-none"
                      />
                      {editModeActions}
                      <button
                        onClick={onClearChatHistory}
                        title={t('promptbar.clear_chat')}
                        className="p-1.5 rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-contrast)] hover:text-red-500 flex-shrink-0"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                      <button
                        onClick={onSendChatMessage}
                        disabled={isLoading || !chatInput.trim()}
                        className="p-1.5 rounded-full bg-[var(--color-indigo)] text-white hover:bg-[var(--color-indigo-hover)] disabled:bg-gray-500 disabled:cursor-not-allowed flex-shrink-0">
                        <SendIcon className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {(getPromptMode() === 'generate' || (getPromptMode() === 'edit' && isPromptExpanded)) && (
            <div
              className="absolute right-3 top-4 flex items-center gap-2"
              style={{ pointerEvents: isLoading ? 'none' : 'auto' }}
            >
              {getPromptMode() === 'generate' ? (
                <div className="flex items-center gap-2">
                  <div className="flex items-center bg-[var(--color-bg)] p-0.5 rounded-lg border border-[var(--color-border)]">
                    <button
                      onClick={() => setPromptMode('edit')}
                      title={t('promptbar.mode_prompt')}
                      className={`p-1.5 rounded-md transition-colors ${getPromptMode() === 'edit' ? 'bg-[var(--color-indigo)] text-white' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-contrast)]'}`}
                    >
                      <ChatIcon className="h-5 w-5" />
                    </button>
                    <button
                      onClick={() => setPromptMode('generate')}
                      title={t('promptbar.mode_generate')}
                      className={`p-1.5 rounded-md transition-colors ${getPromptMode() === 'generate' ? 'bg-[var(--color-indigo)] text-white' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-contrast)]'}`}
                    >
                      <MagicWandIcon className="h-5 w-5" />
                    </button>
                  </div>
                  <div className="h-8 w-px bg-[var(--color-border)]"></div>
                  <button
                    onClick={handleSynthesizeClick}
                    disabled={!canSynthesize || isLoading}
                    className="px-3 py-2 bg-purple-600 hover:bg-purple-700 rounded-md text-sm font-semibold text-white transition-colors flex items-center gap-2 disabled:bg-gray-500 disabled:cursor-not-allowed"
                  >
                    {isSynthesizing && <div className="w-4 h-4 border-2 border-t-transparent border-white rounded-full animate-spin"></div>}
                    <span>{t('common.synthesize')}</span>
                  </button>
                  <button
                    onClick={handleGenerateClick}
                    disabled={isLoading}
                    className="px-3 py-2 bg-[var(--color-indigo)] hover:bg-[var(--color-indigo-hover)] rounded-md text-sm font-semibold text-white transition-colors flex items-center gap-2 disabled:bg-gray-500 disabled:cursor-wait"
                  >
                    {isGenerating && <div className="w-4 h-4 border-2 border-t-transparent border-white rounded-full animate-spin"></div>}
                    <span>{t('common.generate')}</span>
                  </button>
                </div>
              ) : (
                editModeActions
              )}
            </div>
          )}

          <button
            onClick={() => setIsPromptExpanded(!isPromptExpanded)}
            title={t(isPromptExpanded ? 'promptbar.collapse' : 'promptbar.expand')}
            className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[var(--color-bg-contrast)] hover:bg-[var(--color-text-secondary)] text-[var(--color-text-primary)] rounded-full p-1 z-10">
            {isPromptExpanded ? <ChevronUpIcon className="w-4 h-4" /> : <ChevronDownIcon className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
};