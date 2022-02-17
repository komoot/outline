import Token from "markdown-it/lib/token";
import { OpenIcon } from "outline-icons";
import { toggleMark } from "prosemirror-commands";
import { InputRule } from "prosemirror-inputrules";
import { MarkdownSerializerState } from "prosemirror-markdown";
import {
  MarkSpec,
  MarkType,
  Node,
  Mark as ProsemirrorMark,
} from "prosemirror-model";
import { Transaction, EditorState, Plugin } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import * as React from "react";
import ReactDOM from "react-dom";
import { isInternalUrl } from "../../utils/urls";
import findLinkNodes from "../queries/findLinkNodes";
import Mark from "./Mark";

const LINK_INPUT_REGEX = /\[([^[]+)]\((\S+)\)$/;

function isPlainURL(
  link: ProsemirrorMark,
  parent: Node,
  index: number,
  side: -1 | 1
) {
  if (link.attrs.title || !/^\w+:/.test(link.attrs.href)) {
    return false;
  }

  const content = parent.child(index + (side < 0 ? -1 : 0));
  if (
    !content.isText ||
    content.text !== link.attrs.href ||
    content.marks[content.marks.length - 1] !== link
  ) {
    return false;
  }

  if (index === (side < 0 ? 1 : parent.childCount - 1)) {
    return true;
  }

  const next = parent.child(index + (side < 0 ? -2 : 1));
  return !link.isInSet(next.marks);
}

export default class Link extends Mark {
  get name() {
    return "link";
  }

  get schema(): MarkSpec {
    return {
      attrs: {
        href: {
          default: "",
        },
      },
      inclusive: false,
      parseDOM: [
        {
          tag: "a[href]",
          getAttrs: (dom: HTMLElement) => ({
            href: dom.getAttribute("href"),
          }),
        },
      ],
      toDOM: (node) => [
        "a",
        {
          ...node.attrs,
          rel: "noopener noreferrer nofollow",
        },
        0,
      ],
    };
  }

  inputRules({ type }: { type: MarkType }) {
    return [
      new InputRule(LINK_INPUT_REGEX, (state, match, start, end) => {
        const [okay, alt, href] = match;
        const { tr } = state;

        if (okay) {
          tr.replaceWith(start, end, this.editor.schema.text(alt)).addMark(
            start,
            start + alt.length,
            type.create({ href })
          );
        }

        return tr;
      }),
    ];
  }

  commands({ type }: { type: MarkType }) {
    return ({ href } = { href: "" }) => toggleMark(type, { href });
  }

  keys({ type }: { type: MarkType }) {
    return {
      "Mod-k": (state: EditorState, dispatch: (tr: Transaction) => void) => {
        if (state.selection.empty) {
          this.options.onKeyboardShortcut();
          return true;
        }

        return toggleMark(type, { href: "" })(state, dispatch);
      },
    };
  }

  get plugins() {
    const getLinkDecorations = (doc: Node) => {
      const decorations: Decoration[] = [];
      const links = findLinkNodes(doc);

      links.forEach((nodeWithPos) => {
        const linkMark = nodeWithPos.node.marks.find(
          (mark) => mark.type.name === "link"
        );
        if (linkMark && !isInternalUrl(linkMark.attrs.href)) {
          decorations.push(
            Decoration.widget(
              // place the decoration at the end of the link
              nodeWithPos.pos + nodeWithPos.node.nodeSize,
              () => {
                const component = <OpenIcon color="currentColor" size={16} />;
                const icon = document.createElement("span");
                icon.className = "external-link";
                ReactDOM.render(component, icon);
                return icon;
              },
              {
                // position on the right side of the position
                side: 1,
              }
            )
          );
        }
      });

      return DecorationSet.create(doc, decorations);
    };

    const plugin: Plugin = new Plugin({
      state: {
        init: (config, state) => {
          return getLinkDecorations(state.doc);
        },
        apply: (tr, oldState) => {
          return tr.docChanged ? getLinkDecorations(tr.doc) : oldState;
        },
      },
      props: {
        decorations: (state) => plugin.getState(state),
        handleDOMEvents: {
          mouseover: (_view, event: MouseEvent) => {
            if (
              event.target instanceof HTMLAnchorElement &&
              !event.target.className.includes("ProseMirror-widget")
            ) {
              if (this.options.onHoverLink) {
                return this.options.onHoverLink(event);
              }
            }
            return false;
          },
          click: (view, event: MouseEvent) => {
            if (!(event.target instanceof HTMLAnchorElement)) {
              return false;
            }

            // clicking a link while editing should show the link toolbar,
            // clicking in read-only will navigate
            if (!view.editable) {
              const href =
                event.target.href ||
                (event.target.parentNode instanceof HTMLAnchorElement
                  ? event.target.parentNode.href
                  : "");

              const isHashtag = href.startsWith("#");
              if (isHashtag && this.options.onClickHashtag) {
                event.stopPropagation();
                event.preventDefault();
                this.options.onClickHashtag(href, event);
              }

              if (this.options.onClickLink) {
                event.stopPropagation();
                event.preventDefault();
                this.options.onClickLink(href, event);
              }
              return true;
            }

            return false;
          },
        },
      },
    });

    return [plugin];
  }

  toMarkdown() {
    return {
      open(
        _state: MarkdownSerializerState,
        mark: ProsemirrorMark,
        parent: Node,
        index: number
      ) {
        return isPlainURL(mark, parent, index, 1) ? "<" : "[";
      },
      close(
        state: MarkdownSerializerState,
        mark: ProsemirrorMark,
        parent: Node,
        index: number
      ) {
        return isPlainURL(mark, parent, index, -1)
          ? ">"
          : "](" +
              state.esc(mark.attrs.href) +
              (mark.attrs.title ? " " + state.quote(mark.attrs.title) : "") +
              ")";
      },
    };
  }

  parseMarkdown() {
    return {
      mark: "link",
      getAttrs: (tok: Token) => ({
        href: tok.attrGet("href"),
        title: tok.attrGet("title") || null,
      }),
    };
  }
}
