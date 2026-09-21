import React, { useState, useEffect, createContext, useContext, ReactNode, useCallback } from "react";
import { DEFAULT_THEME } from './config';

const THEME = {
    LIGHT: "light",
    DARK: "dark"
} as const;

type ThemeType = typeof THEME[keyof typeof THEME];

interface ThemeContextProps {
    theme: ThemeType;
    setTheme: (theme: ThemeType) => void;
    toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextProps | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {

    const [currentTheme, setCurrentTheme] = useState<ThemeType>(DEFAULT_THEME);

    const setTheme = useCallback((theme: ThemeType) => {
        setCurrentTheme(theme);
    }, []);

    const toggleTheme = useCallback(() => {
        setCurrentTheme(prevTheme => prevTheme === THEME.LIGHT ? THEME.DARK : THEME.LIGHT);
    }, []);

    // 同步 body 类名：dark → 加 theme-dark + aui3_1_dark，否则移除
    // （theme-dark 驱动 hui-base-dark.css 的 body.theme-dark 变量块；
    //  aui3_1_dark 驱动 eview-react 组件暗色样式覆盖，如 .aui3_1_dark .ev_tag.info）
    useEffect(() => {
        const body = document.body;
        if (currentTheme === THEME.DARK) {
            body.classList.add('theme-dark', 'aui3_1_dark');
        } else {
            body.classList.remove('theme-dark', 'aui3_1_dark');
        }
    }, [currentTheme]);

    return (
        <ThemeContext.Provider
            value={{
                theme: currentTheme,
                setTheme,
                toggleTheme
            }}>
            {children}
        </ThemeContext.Provider>
    )
}

export function useTheme(): ThemeContextProps {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error("useTheme must be used within a ThemeProvider");
    }
    return context;
}
