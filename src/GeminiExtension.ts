import { StateField, StateEffect } from '@codemirror/state'
import { EditorView, Decoration, type DecorationSet } from '@codemirror/view'
import Gemini from 'GeminiService'
import { nanoid } from 'nanoid'
import GeminiAssistantPlugin from 'main'
import type { GeminiPrompt } from 'Settings'

const createStateFiled = () => {
    const f: StateField<DecorationSet> = StateField.define<DecorationSet>({
        create() {
            return Decoration.none
        },
        update(widgets, tr) {
            widgets = widgets.map(tr.changes)
            for (let e of tr.effects) {
                if (e.is(addGemini)) {
                    const updated = e.map(tr.changes) || e
                    const geminiMark = Decoration.mark({
                        class: 'gemini-widget',
                        id: e.value.id,
                        tagName: 'span',
                    })
                    widgets = widgets.update({
                        add: [
                            geminiMark.range(
                                updated.value.from,
                                updated.value.to,
                            ),
                        ],
                    })
                    // widgets = widgets.update({
                    //     add: [
                    //         {
                    //             from: updated.value.from,
                    //             to: updated.value.to,
                    //             value: Decoration.widget({
                    //                 widget: new GeminiWidget(updated.value.id),
                    //                 side: 1,
                    //                 block: true,
                    //                 id: updated.value.id,
                    //             }),
                    //         },
                    //     ],
                    // })
                }
            }
            return widgets
        },
        // provide: (field) =>
        //     EditorView.atomicRanges.of((view) => {
        //         return view.state.field(field)
        //     }),
        provide: (field) => EditorView.decorations.from(field),
    })
    return f
}

export class GeminiExtension {
    public gemini: Gemini
    private field: StateField<DecorationSet>

    constructor(plugin: GeminiAssistantPlugin) {
        this.gemini = new Gemini(plugin)
        this.field = createStateFiled()
    }

	public updateApiKey(key: string) {
		this.gemini.updateApiKey(key)

	}

    public async generate(view: EditorView, option: GeminiPrompt) {
        if (option.prompt.length == 0) {
            return
        }

        let cursor = view.state.selection.main.to
        let line = view.state.doc.lineAt(cursor)
        let id = nanoid()

        // append line breaks
        view.dispatch({
            changes: [
                {
                    from: line.to,
                    // insert a callout block
                    insert: `\n\n>[!gemini]+ Gemini (${option.model})\n> `,
                },
            ],
            effects: [addGemini.of({ from: line.to, to: line.to, prompt, id })],
        })

        try {
            const result = await this._generate(option)
            let prevChunk = null
            for await (const chunk of result.stream) {
                if (prevChunk !== null) {
                    this.processChunk(view, id, prevChunk.text(), false)
                }
                prevChunk = chunk
            }
            if (prevChunk !== null) {
                this.processChunk(view, id, prevChunk.text(), true)
            }
        } catch (e: any) {
            this.processChunk(
                view,
                id,
                `<span style="color: var(--text-error)">${
                    e?.toString() || 'Unknown Error'
                }</span>`,
                true,
            )
        }
    }

    private processChunk(
        view: EditorView,
        id: string,
        text: string,
        last: boolean,
    ) {
        let to = this.findRangeById(view, id)
        if (to < 0) {
            return
        }

        const pattern = /\r?\n/g
        let format = text.replace(pattern, '\n> ')

        if (last) {
            format += '\n'
        }

        const changes = [
            {
                from: to,
                insert: format,
            },
        ]

        view.dispatch({ changes })
    }

    private findRangeById(view: EditorView, id: string) {
        const range = view.state.field(this.field).iter()
        let deco = range.value
        let to = -1

        while (deco) {
            if (deco.spec.id == id) {
                to = range.to - 1
                break
            }
            range.next()
            deco = range.value
        }

        return to
    }

    private async _generate(option: GeminiPrompt) {
        const result = await this.gemini.generate(option)
        return result ? (result as any) : { stream: [] }
    }

    public getExtension() {
        return this.field
    }
}

export const addGemini = StateEffect.define<{
    id: string
    from: number
    to: number
    prompt: any
}>({
    map: (value, change) => {
        return {
            from: change.mapPos(value.from),
            to: change.mapPos(value.to, 1),
            prompt,
            id: value.id,
        }
    },
})
