import React, { useState, useRef, useEffect, useMemo } from 'react';
import { allLanguages } from './constants';

interface LanguageSelectorProps {
    value: string;
    onChange: (code: string) => void;
    t: (key: string) => string;
    includeAuto?: boolean;
}

export const LanguageSelector: React.FC<LanguageSelectorProps> = ({ value, onChange, t, includeAuto = false }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState("");
    const dropdownRef = useRef<HTMLDivElement>(null);

    const filteredLanguages = useMemo(() => {
        const lowerSearch = search.toLowerCase();
        const langs = allLanguages.filter(l =>
            l.name.toLowerCase().includes(lowerSearch) ||
            l.code.toLowerCase().includes(lowerSearch)
        );

        // Add auto-detect option at the beginning if enabled
        if (includeAuto) {
            const autoDetect = { code: 'auto', name: '检测语言 (Auto-detect)' };
            if (!search || autoDetect.name.toLowerCase().includes(lowerSearch)) {
                return [autoDetect, ...langs];
            }
        }

        return langs;
    }, [search, includeAuto]);

    const selectedName = value === 'auto'
        ? '检测语言'
        : allLanguages.find(l => l.code === value)?.name || value;

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Reset search when opened
    useEffect(() => {
        if (isOpen) setSearch("");
    }, [isOpen]);

    return (
        <div className="custom-select-container" ref={dropdownRef}>
            <button
                className={`custom-select-trigger ${isOpen ? 'active' : ''}`}
                onClick={() => setIsOpen(!isOpen)}
            >
                <span className="selected-text">{selectedName}</span>
                <span className="arrow">▼</span>
            </button>

            {isOpen && (
                <div className="custom-select-dropdown">
                    <div className="custom-select-search-wrapper">
                        <input
                            type="text"
                            className="custom-select-search"
                            placeholder={t('searchLanguage') || 'Search language...'}
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                        />
                    </div>
                    <div className="custom-select-options">
                        {filteredLanguages.length > 0 ? (
                            filteredLanguages.map(lang => (
                                <div
                                    key={lang.code}
                                    className={`custom-select-option ${lang.code === value ? 'selected' : ''}`}
                                    onClick={() => {
                                        onChange(lang.code);
                                        setIsOpen(false);
                                    }}
                                >
                                    {lang.name}
                                </div>
                            ))
                        ) : (
                            <div className="custom-select-option no-results">No languages found</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
