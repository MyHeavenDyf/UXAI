// jk-j60099994-replace-with-60062650-dialog-iframe-1-start
    export function useDialogIframe () {
        return {
            show: (cb: (data: string) => {}) => {
                cb(JSON.stringify({a: 1}))
            }
        }
    }
// jk-j60099994-replace-with-60062650-dialog-iframe-1-end