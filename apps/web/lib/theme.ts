export const THEME_STORAGE_KEY = "theme";

/**
 * Runs before hydration (inlined in <head>) so a stored theme is applied
 * before first paint. With no stored choice the OS preference applies via CSS.
 */
export const themeInitScript = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t==="light"||t==="dark"){document.documentElement.classList.add(t);}}catch(e){}})();`;
