// AI Tool type definition
export interface AITool {
    id: string;
    name: string;
    category: 'chatbot' | 'image' | 'video' | 'audio' | 'writing' | 'code' | 'productivity' | 'other';
    icon?: string;
    website: string;
    description: string;
    pricing: 'free' | 'freemium' | 'paid' | 'trial';
    freeQuota?: string;
    tags?: string[];
    safety: 'safe' | 'unknown' | 'unsafe';
    // For user-added tools
    isCustom?: boolean;
    addedBy?: string;
    sharedByEmail?: string;
}

export interface AIToolFilterState {
    search: string;
    category: string;
    pricing: string;
    safety: string;
}
