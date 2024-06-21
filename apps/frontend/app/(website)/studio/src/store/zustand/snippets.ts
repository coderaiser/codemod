import { isFile } from "@babel/types";
import type { KnownEngines } from "@codemod-com/utilities";
import type { OffsetRange } from "@studio/schemata/offsetRangeSchemata";
import {
  AFTER_SNIPPET_DEFAULT_CODE,
  BEFORE_SNIPPET_DEFAULT_CODE,
} from "@studio/store/getInitialState";
import { useCodemodOutputStore } from "@studio/store/zustand/codemodOutput";
import type { TreeNode } from "@studio/types/tree";
import { parseSnippet } from "@studio/utils/babelParser";
import mapBabelASTToRenderableTree from "@studio/utils/mappers";
import { type RangeCommand, buildRanges } from "@studio/utils/tree";
import {
  path,
  assocPath,
  is,
  map,
  mapObjIndexed,
  pathSatisfies,
  reduce,
} from "ramda";
import { create } from "zustand";

export type Token = Readonly<{
  start: number;
  end: number;
  value?: string;
}>;

type SnippetValues = {
  content: string;
  rootNode: TreeNode | null;
  ranges: ReadonlyArray<TreeNode | OffsetRange>;
  tokens: ReadonlyArray<Token>;
  rangeUpdatedAt: number;
};
type SnippetSetters = {
  setContent: (input: string) => void;
  setSelection: (command: RangeCommand) => void;
};

type SnippetValuesMap = {
  [K in EditorType as `${K}Snippet`]: SnippetValues["content"];
};

type SnippetSettersMap = {
  [K in EditorType as `set${Capitalize<K>}Snippet`]: SnippetSetters["setContent"];
};
type SnippetsConfig = {
  clearAll: () => void;
  selectedPairIndex: number;
  engine: KnownEngines;
  getSelectedEditors: () => Editors &
    SnippetValuesMap &
    SnippetSettersMap & {
      setSelection: (x: EditorType) => (command: RangeCommand) => void;
      setRanges: (x: EditorType) => (command: RangeCommand) => void;
    };
  setEngine: (engine: KnownEngines) => void;
  setSelectedPairIndex: (index: number) => void;
};

type Editors = {
  before: SnippetValues;
  after: SnippetValues;
  output: SnippetValues;
};
type AllEditors = {
  [x in keyof Editors]: SnippetValues[];
};
type EditorType = keyof Editors;
type AllSnippets = {
  before: string[];
  after: string[];
  output: string[];
};
type SnippetsValues = { editors: Editors[]; getAllSnippets: () => AllSnippets };
type SnippetsState = SnippetsValues & SnippetsSetters & SnippetsConfig;

type SnippetsSetters = {
  [x in keyof SnippetSetters]: (
    editorsPairIndex: number,
    type: EditorType,
  ) => SnippetSetters[x];
};
const getSnippetInitialState = (defaultContent = ""): SnippetValues => {
  const content = defaultContent;
  const contentParsed = parseSnippet(content);

  const rootNode = isFile(contentParsed)
    ? mapBabelASTToRenderableTree(contentParsed)
    : null;

  const tokens: SnippetValues["tokens"] = isFile(contentParsed)
    ? Array.isArray(contentParsed.tokens)
      ? // @ts-ignore
        contentParsed.tokens.map(({ start, end, value }) => ({
          start,
          end,
          value: value ?? "".slice(start, end),
        }))
      : []
    : [];

  return {
    rootNode,
    ranges: [],
    content,
    tokens,
    rangeUpdatedAt: Date.now(),
  };
};

export const useSnippetsStore = create<SnippetsState>((set, get) => ({
  editors: [
    {
      before: getSnippetInitialState(BEFORE_SNIPPET_DEFAULT_CODE),
      after: getSnippetInitialState(AFTER_SNIPPET_DEFAULT_CODE),
      output: getSnippetInitialState(),
    },
  ],
  clearAll: () =>
    set({
      editors: [
        {
          before: getSnippetInitialState(),
          after: getSnippetInitialState(),
          output: getSnippetInitialState(),
        },
      ],
    }),
  engine: "jscodeshift",
  selectedPairIndex: 0,
  getAllSnippets: () =>
    mapObjIndexed(
      map(({ content }: SnippetValues) => content),
      reduce(
        (acc, { before, after, output }) => ({
          before: [...acc.before, before],
          after: [...acc.after, after],
          output: [...acc.output, output],
        }),
        {
          before: [],
          after: [],
          output: [],
        } as AllEditors,
        get().editors,
      ),
    ),
  setSelectedPairIndex: (i: number) => set({ selectedPairIndex: i }),
  getSelectedEditors: () => {
    const index = get().selectedPairIndex || 0;
    const editors = get().editors?.[index] as Editors;
    return {
      ...editors,
      beforeSnippet: editors.before.content,
      afterSnippet: editors.after.content,
      outputSnippet: editors.output.content,
      setBeforeSnippet: get().setContent(index, "before"),
      setAfterSnippet: get().setContent(index, "after"),
      setOutputSnippet: get().setContent(index, "output"),
      setSelection: (editorType: EditorType) =>
        get().setSelection(index, editorType),
    };
  },
  setEngine: (engine) =>
    set({
      engine,
    }),
  setContent: (editorsPairIndex, type) => {
    return (content) => {
      const parsed = parseSnippet(content);
      const rootNode = isFile(parsed)
        ? mapBabelASTToRenderableTree(parsed)
        : null;

      const rpath = ["editors", editorsPairIndex, type];

      const obj = get();
      if (pathSatisfies(is(Object), rpath, obj)) {
        set(
          assocPath(
            rpath,
            {
              ...path(rpath, obj),
              content,
              rootNode,
            },
            obj,
          ),
        );
      } else set(obj);
    };
  },
  setSelection: (editorsPairIndex, type) => (command) => {
    const rootNode = get().editors[editorsPairIndex]?.[type]?.rootNode;
    if (rootNode) {
      const ranges = buildRanges(rootNode, command);
      const rpath = ["editors", editorsPairIndex, type];

      const obj = get();
      if (pathSatisfies(is(Object), rpath, obj)) {
        set(
          assocPath(
            rpath,
            {
              ...path(rpath, obj),
              ranges,
              rangeUpdatedAt: Date.now(),
            },
            obj,
          ),
        );
      } else set(obj);
    }
  },
}));

export const useSelectFirstTreeNodeForSnippet = () => {
  const state = useSnippetsStore();
  const { ranges } = useCodemodOutputStore();
  let firstRange: TreeNode | OffsetRange | undefined;

  return (type: EditorType) => {
    if (type === "output") firstRange = ranges[0];
    else firstRange = state.editors[state.selectedPairIndex]?.[type].ranges[0];

    return firstRange && "id" in firstRange ? firstRange : null;
  };
};

export const useSelectSnippets = (type: EditorType) => {
  // @TODO make reusable reducer for the code snippet
  // that will include snippet, rootNode, ranges,

  const empty = {
    snippet: "",
    rootNode: null,
    ranges: [],
  };

  const { editors, selectedPairIndex } = useSnippetsStore();

  const { ranges, content: outputSnippet, rootNode } = useCodemodOutputStore();

  if (!editors[selectedPairIndex]) return empty;
  const {
    before: {
      content: beforeSnippet,
      rootNode: beforeInputRootNode,
      ranges: beforeInputRanges,
    },

    after: {
      content: afterSnippet,
      rootNode: afterInputRootNode,
      ranges: afterInputRanges,
    },
  } = editors[selectedPairIndex] as Editors;

  switch (type) {
    case "before":
      return {
        snippet: beforeSnippet,
        rootNode: beforeInputRootNode,
        ranges: beforeInputRanges,
      };
    case "after":
      return {
        snippet: afterSnippet,
        rootNode: afterInputRootNode,
        ranges: afterInputRanges,
      };

    case "output":
      return {
        snippet: outputSnippet,
        rootNode,
        ranges,
      };

    default:
      return empty;
  }
};
