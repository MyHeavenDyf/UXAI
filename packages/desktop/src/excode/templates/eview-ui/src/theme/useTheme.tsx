import React, { useState, useEffect, createContext, useContext, ReactNode, useCallback, useMemo } from "react";
import { DEFAULT_THEME } from './config';
import { ConfigProvider } from '@cloudsop/eview-ui';

const THEME = {
    LIGHT: "light",
    DARK: "dark"
} as const;

const EUI_THEME = {
    [THEME.LIGHT]: "lightday",
    [THEME.DARK]: "evening"
} as const;

type ThemeType = typeof THEME[keyof typeof THEME];

type EuiThemeType = typeof EUI_THEME[keyof typeof EUI_THEME];

interface ThemeContextProps {
    theme: ThemeType;
    setTheme: (theme: ThemeType) => void;
    toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextProps | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {

    const [currentTheme, setCurrentTheme] = useState<ThemeType>(DEFAULT_THEME);

    const euiTheme = useMemo<EuiThemeType>(() => EUI_THEME[currentTheme], [currentTheme]);

    const setTheme = useCallback((theme: ThemeType) => {
        setCurrentTheme(theme);
    }, []);

    const toggleTheme = useCallback(() => {
        setCurrentTheme(prevTheme => prevTheme === THEME.LIGHT ? THEME.DARK : THEME.LIGHT);
    }, []);

    // 同步 body 类名：dark → 加 theme-dark，否则移除（驱动 hui-base-dark.css 的 body.theme-dark 变量块）
    useEffect(() => {
        const body = document.body;
        if (currentTheme === THEME.DARK) {
            body.classList.add('theme-dark');
        } else {
            body.classList.remove('theme-dark');
        }
    }, [currentTheme]);

    return (
        <ThemeContext.Provider
            value={{
                theme: currentTheme,
                setTheme,
                toggleTheme
            }}>
            <ConfigProvider locale="zh" version="aui3-1" theme={euiTheme}>
                {children}
            </ConfigProvider>
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
