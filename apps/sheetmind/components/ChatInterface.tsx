
import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Loader2, BarChart3, PieChart as PieChartIcon } from 'lucide-react';
import { ChatMessage, SheetData } from '../types';
import { analyzeData } from '../services/geminiService';
import ReactMarkdown from 'react-markdown';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Legend } from 'recharts';
import { GoogleGenAI } from "@google/genai";

interface ChatInterfaceProps {
    data: SheetData;
    getAiInstance: () => GoogleGenAI;
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d'];

const ChatInterface: React.FC<ChatInterfaceProps> = ({ data, getAiInstance }) => {
    const [messages, setMessages] = useState<ChatMessage[]>([
        {
            id: 'welcome',
            role: 'model',
            text: `您已加载 **${data.fileName}**，共 ${data.rows.length} 行数据。\n\n💡 **数据存储在本地**，只有您发送问题后才会调用 AI 分析。\n\n我可以帮您：\n- 识别数据趋势\n- 分类和统计\n- **生成可视化图表**（试试问我"统计一下XX的数量"）\n\n请输入您的问题：`
        }
    ]);
    const [input, setInput] = useState('');
    const [isThinking, setIsThinking] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    const handleSend = async () => {
        if (!input.trim() || isThinking) return;

        const userMsg: ChatMessage = {
            id: Date.now().toString(),
            role: 'user',
            text: input
        };

        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setIsThinking(true);

        try {
            const historyText = messages.slice(-5).map(m => `${m.role}: ${m.text}`);

            // Call analyzeData which now returns { text, relatedChart }
            const { text, relatedChart } = await analyzeData(userMsg.text, data, historyText, getAiInstance);

            const botMsg: ChatMessage = {
                id: (Date.now() + 1).toString(),
                role: 'model',
                text: text,
                relatedChart: relatedChart
            };

            setMessages(prev => [...prev, botMsg]);
        } catch (error) {
            const errorMsg: ChatMessage = {
                id: (Date.now() + 1).toString(),
                role: 'model',
                text: "分析数据时出错。请检查您的 API 密钥或尝试更简单的查询。",
                isError: true
            };
            setMessages(prev => [...prev, errorMsg]);
        } finally {
            setIsThinking(false);
        }
    };

    const renderChart = (msg: ChatMessage) => {
        if (!msg.relatedChart || !msg.relatedChart.data) return null;

        const { type, data, title } = msg.relatedChart;

        return (
            <div className="mt-4 mb-2 bg-slate-50 p-4 rounded-xl border border-slate-200 w-full h-[300px]">
                <h4 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                    {type === 'pie' ? <PieChartIcon size={16} className="text-orange-500" /> : <BarChart3 size={16} className="text-blue-500" />}
                    {title || "数据分析图表"}
                </h4>
                <ResponsiveContainer width="100%" height="100%">
                    {type === 'pie' ? (
                        <PieChart>
                            <Pie
                                data={data}
                                cx="50%"
                                cy="50%"
                                innerRadius={40}
                                outerRadius={80}
                                paddingAngle={5}
                                dataKey="value"
                                label={({ name, value }) => `${name}: ${value}`}
                            >
                                {data.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                ))}
                            </Pie>
                            <Tooltip />
                            <Legend />
                        </PieChart>
                    ) : (
                        <BarChart data={data} layout="vertical" margin={{ left: 10, right: 30 }}>
                            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                            <XAxis type="number" hide />
                            <YAxis dataKey="name" type="category" width={80} tick={{ fontSize: 12 }} />
                            <Tooltip cursor={{ fill: '#f1f5f9' }} />
                            <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={20}>
                                {data.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                ))}
                            </Bar>
                        </BarChart>
                    )}
                </ResponsiveContainer>
            </div>
        );
    };

    const suggestions = [
        "总结这份数据",
        "统计各状态的数量",
        "画一个类别分布的饼图",
        "分析图片链接分布"
    ];

    return (
        <div className="flex flex-col h-full bg-slate-50 w-full transition-all">
            <div className="flex-1 overflow-y-auto p-4 space-y-4" ref={scrollRef}>
                {messages.map((msg) => (
                    <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'model' ? 'bg-purple-100 text-purple-600' : 'bg-slate-200 text-slate-600'}`}>
                            {msg.role === 'model' ? <Bot size={18} /> : <User size={18} />}
                        </div>

                        <div className={`max-w-[90%] rounded-2xl p-3 text-sm leading-relaxed ${msg.role === 'user'
                            ? 'bg-blue-600 text-white rounded-tr-none'
                            : 'bg-white border border-slate-200 text-slate-700 rounded-tl-none shadow-sm'
                            } ${msg.isError ? 'bg-red-50 border-red-200 text-red-600' : ''}`}>
                            {msg.role === 'model' ? (
                                <>
                                    <div className="prose prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-table:text-xs">
                                        <ReactMarkdown>{msg.text}</ReactMarkdown>
                                    </div>
                                    {renderChart(msg)}
                                </>
                            ) : (
                                msg.text
                            )}
                        </div>
                    </div>
                ))}

                {isThinking && (
                    <div className="flex gap-3">
                        <div className="w-8 h-8 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center shrink-0">
                            <Bot size={18} />
                        </div>
                        <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-none p-4 shadow-sm flex items-center gap-2">
                            <Loader2 className="animate-spin text-purple-600" size={16} />
                            <span className="text-xs text-slate-500">正在分析表格...</span>
                        </div>
                    </div>
                )}
            </div>

            <div className="p-4 bg-white border-t border-slate-200 sticky bottom-0 z-10">
                {messages.length < 3 && (
                    <div className="flex flex-wrap gap-2 mb-3">
                        {suggestions.map((s, i) => (
                            <button
                                key={i}
                                onClick={() => setInput(s)}
                                className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-1.5 rounded-full transition-colors border border-slate-200"
                            >
                                {s}
                            </button>
                        ))}
                    </div>
                )}
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                        placeholder="输入您的问题..."
                        className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
                    />
                    <button
                        onClick={handleSend}
                        disabled={!input.trim() || isThinking}
                        className="p-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        <Send size={18} />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ChatInterface;
