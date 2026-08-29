// jk-j60099994-replace-with-60062650-dialog-iframe-1-start
    export function useDialogIframe () {
        return {
            show: (cb: (data: string) => void) => {
                cb(JSON.stringify({
                    user: {
                        designSpec: 'html-prototype',
                    },
                    options: {
                        designSpec: {
                            'html-prototype': {
                                label: 'html-prototype'
                            },
                            basics: {
                                label: 'design-basics'
                            }
                        },

                    }
                }))
            }
        }
    }
// jk-j60099994-replace-with-60062650-dialog-iframe-1-end