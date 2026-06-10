/**
 * @description 判断是否为空对象或空值
 * @param {any} v - 要检查的值
 * @returns {boolean} - 如果为空对象或空值返回 true，否则返回 false
 */
export function isEmptyObject(v: any): boolean {
    if (!v || v === 'null' || v === undefined || v === null) {
        return true
    }
    
    // 检查是否为对象且不是数组
    if (typeof v !== 'object' || Array.isArray(v)) {
        return false
    }
    
    // Object.keys方法性能更高
    return Object.keys(v).length === 0
}

/**
 * @description 判断是否为有值的对象结构
 * @param {any} v - 要检查的值
 * @returns {boolean} - 如果为有值的非空对象返回 true，否则返回 false
 */
export function isNotEmptyObject(v: any): boolean {
    return typeof v === 'object' && 
           v !== null && 
           !Array.isArray(v) && 
           !isEmptyObject(v)
}