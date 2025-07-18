import TextArea from "../TextArea/TextArea";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  initialValue?: undefined | string;
  placeholder?: undefined | string;
  className?: undefined | string;
  onChange?: undefined | ((value: string) => void);
  onFocus?: (() => void) | undefined;
  onBlur?: (() => void) | undefined;
  tabIndex?: number | undefined;
  error?: string | undefined;
  disableSpellCheck?: boolean | undefined;
}

const MarkdownEditor: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <TextArea
      tabIndex={props.tabIndex}
      className={props.className}
      initialValue={props.initialValue || ""}
      placeholder={props.placeholder}
      onChange={props.onChange ? props.onChange : () => {}}
      onFocus={props.onFocus ? props.onFocus : () => {}}
      onBlur={props.onBlur ? props.onBlur : () => {}}
      error={props.error}
      disableSpellCheck={props.disableSpellCheck}
    />
  );
};

export default MarkdownEditor;
