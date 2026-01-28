import React from 'react';
import { AlertCircle } from 'lucide-react';

export const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'outline' }> = ({ 
  className, 
  variant = 'primary', 
  ...props 
}) => {
  const baseStyles = "px-4 py-2 rounded-md font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed text-sm";
  const variants = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500",
    secondary: "bg-slate-800 text-white hover:bg-slate-900 focus:ring-slate-500",
    outline: "border border-slate-300 text-slate-700 hover:bg-slate-50 focus:ring-slate-400"
  };

  return (
    <button 
      className={`${baseStyles} ${variants[variant]} ${className || ''}`} 
      {...props} 
    />
  );
};

export const Card: React.FC<{ children: React.ReactNode; className?: string; title?: string }> = ({ children, className, title }) => (
  <div className={`bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden ${className || ''}`}>
    {title && (
      <div className="bg-slate-50 px-4 py-3 border-b border-slate-100">
        <h3 className="font-semibold text-slate-700 text-sm uppercase tracking-wide">{title}</h3>
      </div>
    )}
    <div className="p-0">
      {children}
    </div>
  </div>
);

export const Alert: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="bg-amber-50 border-l-4 border-amber-500 p-4 flex items-start gap-3 rounded-r-md">
    <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
    <div className="text-sm text-amber-800">{children}</div>
  </div>
);

export const Badge: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
    {children}
  </span>
);