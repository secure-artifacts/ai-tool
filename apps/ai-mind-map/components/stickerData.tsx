import type React from 'react';
import {
  Briefcase,
  Building,
  BarChart3,
  Calculator,
  GraduationCap,
  BookOpen,
  School,
  Library,
  Cpu,
  Smartphone,
  Laptop,
  Wifi,
  Smile,
  Frown,
  Angry,
  Heart,
  Plane,
  Luggage,
  MapPin,
  Camera,
  Sun,
  Cloud,
  CloudRain,
  Snowflake,
  Coffee,
  Utensils,
  Pizza,
  Beer,
} from 'lucide-react';

export const STICKER_CATEGORIES = [
  { id: 'business', label: '商业', icon: Briefcase },
  { id: 'education', label: '教育', icon: GraduationCap },
  { id: 'tech', label: '技术', icon: Cpu },
  { id: 'emotion', label: '情绪', icon: Smile },
  { id: 'travel', label: '旅行', icon: Plane },
  { id: 'weather', label: '天气', icon: Sun },
  { id: 'food', label: '餐饮', icon: Coffee },
];

export const STICKERS: Record<
  string,
  Array<{ id: string; icon: React.ComponentType<{ size?: number; color?: string; fill?: string; fillOpacity?: number }>; color: string }>
> = {
  business: [
    { id: 'biz-briefcase', icon: Briefcase, color: '#f59e0b' },
    { id: 'biz-building', icon: Building, color: '#3b82f6' },
    { id: 'biz-chart', icon: BarChart3, color: '#10b981' },
    { id: 'biz-calc', icon: Calculator, color: '#6b7280' },
  ],
  education: [
    { id: 'edu-cap', icon: GraduationCap, color: '#8b5cf6' },
    { id: 'edu-book', icon: BookOpen, color: '#ef4444' },
    { id: 'edu-school', icon: School, color: '#eab308' },
    { id: 'edu-lib', icon: Library, color: '#14b8a6' },
  ],
  tech: [
    { id: 'tech-cpu', icon: Cpu, color: '#6366f1' },
    { id: 'tech-phone', icon: Smartphone, color: '#3b82f6' },
    { id: 'tech-laptop', icon: Laptop, color: '#64748b' },
    { id: 'tech-wifi', icon: Wifi, color: '#0ea5e9' },
  ],
  emotion: [
    { id: 'emo-smile', icon: Smile, color: '#eab308' },
    { id: 'emo-frown', icon: Frown, color: '#ef4444' },
    { id: 'emo-angry', icon: Angry, color: '#dc2626' },
    { id: 'emo-heart', icon: Heart, color: '#ec4899' },
  ],
  travel: [
    { id: 'trv-plane', icon: Plane, color: '#0ea5e9' },
    { id: 'trv-bag', icon: Luggage, color: '#a855f7' },
    { id: 'trv-map', icon: MapPin, color: '#ef4444' },
    { id: 'trv-cam', icon: Camera, color: '#374151' },
  ],
  weather: [
    { id: 'wth-sun', icon: Sun, color: '#f59e0b' },
    { id: 'wth-cloud', icon: Cloud, color: '#94a3b8' },
    { id: 'wth-rain', icon: CloudRain, color: '#3b82f6' },
    { id: 'wth-snow', icon: Snowflake, color: '#06b6d4' },
  ],
  food: [
    { id: 'fd-coffee', icon: Coffee, color: '#78350f' },
    { id: 'fd-food', icon: Utensils, color: '#6b7280' },
    { id: 'fd-pizza', icon: Pizza, color: '#f97316' },
    { id: 'fd-beer', icon: Beer, color: '#eab308' },
  ],
};

export const StickerIcon: React.FC<{ sticker: string; size?: number }> = ({ sticker, size = 18 }) => {
  let def: { icon: React.ComponentType<{ size?: number; color?: string; fill?: string; fillOpacity?: number }>; color: string } | null = null;
  Object.values(STICKERS).forEach((list) => {
    const found = list.find((item) => item.id === sticker);
    if (found) def = found;
  });

  if (!def) return null;
  const Icon = def.icon;

  return (
    <span className="sticker-icon-wrap">
      <Icon size={size} color={def.color} fill={def.color} fillOpacity={0.15} />
    </span>
  );
};
