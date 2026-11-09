import { ArrowUp, MessageCircleDashed } from 'lucide-react';
import { Bubble, BubbleContent } from './ui/bubble';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from './ui/input-group';
import { Message, MessageContent } from './ui/message';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from './ui/message-scroller';

export function Chat({
  title,
  description,
  empty,
  busy,
  children,
  composer,
  aside,
  icon: Icon = MessageCircleDashed,
}) {
  return (
    <div className={'workspace' + (aside ? ' with-inspector' : '')}>
      <section className="thread" aria-label={title}>
        {empty ? (
          <div className="welcome">
            <Icon size={26} strokeWidth={1.55} aria-hidden="true" />
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
        ) : (
          <MessageScrollerProvider autoScroll>
            <h1 className="sr-only">{title}</h1>
            <MessageScroller>
              <MessageScrollerViewport>
                <MessageScrollerContent aria-busy={busy} className="px-1 py-6">
                  {children}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton />
            </MessageScroller>
          </MessageScrollerProvider>
        )}
        <div className="composer-dock">{composer}</div>
      </section>
      {aside && <aside className="context-aside">{aside}</aside>}
    </div>
  );
}

export function ChatTurn({ id, question, children }) {
  return (
    <>
      <MessageScrollerItem messageId={id + '-user'} scrollAnchor>
        <Message align="end">
          <MessageContent>
            <Bubble align="end" variant="muted">
              <BubbleContent className="whitespace-pre-wrap">
                {question}
              </BubbleContent>
            </Bubble>
          </MessageContent>
        </Message>
      </MessageScrollerItem>
      <MessageScrollerItem messageId={id + '-model'}>
        <Message>
          <MessageContent className="gap-3">{children}</MessageContent>
        </Message>
      </MessageScrollerItem>
    </>
  );
}

export function ChatInput({
  ref,
  label,
  value,
  onChange,
  onSubmit,
  action,
  placeholder,
  tools,
  readOnly = false,
  control,
}) {
  return (
    <form onSubmit={onSubmit}>
      <InputGroup className="has-disabled:bg-background has-disabled:opacity-100">
        <InputGroupTextarea
          ref={ref}
          aria-label={label}
          value={value}
          placeholder={placeholder}
          readOnly={readOnly}
          rows={2}
          className="max-h-32 min-h-14"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === 'Enter' &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              if (!readOnly && value.trim())
                e.currentTarget.form.requestSubmit();
            }
          }}
        />
        <InputGroupAddon align="block-end" className="justify-between gap-2">
          <div className="composer-tools">{tools}</div>
          {/* A Pause or Stop click can replace the control during its own click event.
            Keep the submit button a distinct DOM node so that click cannot submit the form. */}
          {control ?? (
            <InputGroupButton
              key="submit"
              type="submit"
              variant="default"
              size={action === 'Resume' ? 'sm' : 'icon-sm'}
              className="shrink-0 rounded-full"
              disabled={!value.trim()}
              aria-label={action}
              title={action}
            >
              {action === 'Resume' && 'Resume'}
              <ArrowUp aria-hidden="true" />
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
