import { SelectionRange, Prec } from "@codemirror/state"
import { ViewUpdate, EditorView, Direction } from "@codemirror/view"
import { CodeMirror } from "."

type Measure = {cursors: Piece[]}

class Piece {
  constructor(readonly left: number, readonly top: number,
              readonly height: number,
              readonly fontFamily: string,
              readonly fontSize: string,
              readonly fontWeight: string,
              readonly color: string,
              readonly className: string,
              readonly letter: string,
              readonly partial: boolean) {}

  draw() {
    let elt = document.createElement("div")
    elt.className = this.className
    this.adjust(elt)
    return elt
  }

  adjust(elt: HTMLElement) {
    elt.style.left = this.left + "px"
    elt.style.top = this.top + "px"
    elt.style.height = this.height + "px"
    elt.style.lineHeight = this.height + "px"
    elt.style.fontFamily = this.fontFamily;
    elt.style.fontSize = this.fontSize;
    elt.style.fontWeight = this.fontWeight;
    elt.style.color = this.partial ? "transparent" : this.color;

    elt.className = this.className;
    elt.textContent = this.letter;
  }

  eq(p: Piece) {
    return this.left == p.left && this.top == p.top && this.height == p.height &&
        this.fontFamily == p.fontFamily && this.fontSize == p.fontSize &&
        this.fontWeight == p.fontWeight && this.color == p.color &&
        this.className == p.className &&
        this.letter == p.letter;
  }
}

export class BlockCursorPlugin {
  rangePieces: readonly Piece[] = []
  cursors: readonly Piece[] = []
  measureReq: {read: () => Measure, write: (value: Measure) => void}
  cursorLayer: HTMLElement
  cm: CodeMirror

  constructor(readonly view: EditorView, cm: CodeMirror) {
    this.cm = cm;
    this.measureReq = {read: this.readPos.bind(this), write: this.drawSel.bind(this)}
    this.cursorLayer = view.scrollDOM.appendChild(document.createElement("div"))
    this.cursorLayer.className = "cm-cursorLayer cm-vimCursorLayer"
    this.cursorLayer.setAttribute("aria-hidden", "true")
    view.requestMeasure(this.measureReq)
    this.setBlinkRate() 
  }

  setBlinkRate() {
    this.cursorLayer.style.animationDuration = 1200 + "ms"
  }

  update(update: ViewUpdate) {
     if (update.selectionSet || update.geometryChanged || update.viewportChanged) {
      this.view.requestMeasure(this.measureReq)
      this.cursorLayer.style.animationName = this.cursorLayer.style.animationName == "cm-blink" ? "cm-blink2" : "cm-blink"
     }
  }

  scheduleRedraw() {
    this.view.requestMeasure(this.measureReq)
  }

  readPos(): Measure {
    let {state} = this.view
    let cursors = []
    for (let r of state.selection.ranges) {
      let prim = r == state.selection.main
      let piece = measureCursor(this.cm, this.view, r, prim)
      if (piece) cursors.push(piece)      
    }
    return {cursors}
  }

  drawSel({cursors}: Measure) {
    if (cursors.length != this.cursors.length || cursors.some((c, i) => !c.eq(this.cursors[i]))) {
      let oldCursors = this.cursorLayer.children
      if (oldCursors.length !== cursors.length) {
        this.cursorLayer.textContent = ""
        for (const c of cursors)
          this.cursorLayer.appendChild(c.draw())
      } else {
        cursors.forEach((c, idx) => c.adjust(oldCursors[idx] as HTMLElement))
      }
      this.cursors = cursors
    }
  }

  destroy() {
    this.cursorLayer.remove()
  }
}

 const themeSpec = {
  ".cm-vimMode .cm-line": {
    "& ::selection": {backgroundColor: "transparent !important"},
    "&::selection": {backgroundColor: "transparent !important"},
    caretColor: "transparent !important",
  },
  ".cm-fat-cursor": {
    position: "absolute",
    background: "#ff9696",
    border: "none",
    whiteSpace: "pre",
  },
  "&:not(.cm-focused) .cm-fat-cursor": {
    background: "none",
    outline: "solid 1px #ff9696"
  },
}

export const hideNativeSelection = Prec.highest(EditorView.theme(themeSpec))

function getBase(view: EditorView) {
  let rect = view.scrollDOM.getBoundingClientRect()
  let left = view.textDirection == Direction.LTR ? rect.left : rect.right - view.scrollDOM.clientWidth
  return {left: left - view.scrollDOM.scrollLeft, top: rect.top - view.scrollDOM.scrollTop}
}

function measureCursor(cm: CodeMirror, view: EditorView, cursor: SelectionRange, primary: boolean): Piece | null {
  let head = cursor.head;
  let fatCursor = false;
  let hCoeff = 1;
  let vim = cm.state.vim;
  if (vim && (!vim.insertMode || cm.state.overwrite)) {
    fatCursor = true;
    if (vim.visualBlock && !primary)
      return null;
    if (cursor.anchor < cursor.head) head--;
    if (cm.state.overwrite) hCoeff = 0.2;
    else if (vim.status) hCoeff = 0.5;
  }

  if (fatCursor) {
    let letter = head < view.state.doc.length && view.state.sliceDoc(head, head + 1);
    if (letter && (/[\uDC00-\uDFFF]/.test(letter) && head > 1)) {
      // step back if cursor is on the second half of a surrogate pair
      head--;
      letter = view.state.sliceDoc(head, head + 1);
    }
    let pos = view.coordsAtPos(head, 1);
    if (!pos) return null;
    let base = getBase(view);
    let domAtPos = view.domAtPos(head);
    let node = domAtPos ? domAtPos.node : view.contentDOM;
    while (domAtPos && domAtPos.node instanceof HTMLElement) {
      node = domAtPos.node;
      domAtPos = {node: domAtPos.node.childNodes[domAtPos.offset], offset: 0};
    }
    if (!(node instanceof HTMLElement)) {
      if (!node.parentNode) return null;
      node = node.parentNode;
    }
    let style = getComputedStyle(node as HTMLElement);
    if (!letter || letter == "\n" || letter == "\r") letter = "\xa0";
    else if ((/[\uD800-\uDBFF]/.test(letter) && head < view.state.doc.length - 1)) {
      // include the second half of a surrogate pair in cursor
      letter += view.state.sliceDoc(head + 1, head + 2);
    }
    let h = (pos.bottom - pos.top);
    return new Piece(pos.left - base.left, pos.top - base.top + h * (1 - hCoeff), h * hCoeff,
                     style.fontFamily, style.fontSize, style.fontWeight, style.color,
                     primary ? "cm-fat-cursor cm-cursor-primary" : "cm-fat-cursor cm-cursor-secondary",
                     letter, hCoeff != 1)
  } else {
    return null;
  }
}
