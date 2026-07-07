/**
 * eview-react 组件映射注册入口
 *
 * 手动导入每个组件的映射定义并集中导出。
 * 新组件映射文件在此注册后即可被管线自动发现。
 *
 * 使用方式：
 *   import { default as ComponentName } from './ComponentName';
 *   或直接合并到 default 对象中。
 */
import { default as Button } from './Button';
import { default as Icon } from './Icon';
import { default as Input } from './Input';
import { default as Menu } from './Menu';
import { default as Table } from './Table';

export default {
    Button,
    Icon,
    Input,
    Menu,
    Table,
    // ── 后续组件按字母顺序添加 ──
    // Badge,
    // Carousel,
    // ProgressBar,
    // TextField,
    // ...
};
