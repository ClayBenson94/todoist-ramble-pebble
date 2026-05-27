#include <pebble.h>

// ---- State machine ----

typedef enum {
  STATE_IDLE = 0,
  STATE_RECORDING,
  STATE_PROCESSING,
  STATE_PREVIEW,
  STATE_SUCCESS,
  STATE_ERROR,
  STATE_NO_CONFIG
} AppState;

// ---- Persistent storage keys ----

#define STORAGE_KEY_API_KEY      1
#define STORAGE_KEY_PROJECT_ID   2
#define STORAGE_KEY_AUTO_LAUNCH  3
#define STORAGE_KEY_SKIP_PREVIEW 4

// ---- Globals ----

static Window *s_main_window;
static TextLayer *s_title_layer;
static TextLayer *s_main_layer;
static TextLayer *s_hint_layer;
static Layer *s_divider_layer;

static AppState s_current_state = STATE_IDLE;
static AppTimer *s_state_timer = NULL;
static AppTimer *s_ellipsis_timer = NULL;
static int s_ellipsis_count = 0;

static DictationSession *s_dictation_session = NULL;

static char s_main_text[256];
static char s_hint_text[64];
static char s_api_key[64];
static char s_project_id[32];
static bool s_auto_launch = false;
static bool s_skip_preview = false;

// ---- Preview window globals ----

static Window     *s_preview_window = NULL;
static ScrollLayer *s_preview_scroll_layer = NULL;
static TextLayer  *s_preview_text_layer = NULL;
static TextLayer  *s_preview_title_layer = NULL;
static TextLayer  *s_preview_hint_layer = NULL;
static char        s_preview_text[1024];
static bool        s_preview_confirmed = false;

// ---- Forward declarations ----

static void set_state(AppState state);
static void cancel_state_timer(void);
static void cancel_ellipsis_timer(void);
static void preview_window_push(void);

// ---- Divider drawing ----

static void divider_update_proc(Layer *layer, GContext *ctx) {
  GRect bounds = layer_get_bounds(layer);
  graphics_context_set_stroke_color(ctx, GColorLightGray);
  graphics_draw_line(ctx, GPoint(0, 0), GPoint(bounds.size.w, 0));
}

// ---- State display helpers ----

static void update_display(void) {
  text_layer_set_text(s_main_layer, s_main_text);
  text_layer_set_text(s_hint_layer, s_hint_text);
}

static void show_idle(void) {
  snprintf(s_main_text, sizeof(s_main_text),
           "Press Select and speak your tasks.\n\nI'll add them to Todoist.");
  snprintf(s_hint_text, sizeof(s_hint_text), "Select: Start");
  update_display();
}

static void show_recording(void) {
  snprintf(s_main_text, sizeof(s_main_text), "Listening...");
  snprintf(s_hint_text, sizeof(s_hint_text), "(Speak now)");
  update_display();
}

static void show_processing(void) {
  snprintf(s_main_text, sizeof(s_main_text), "Adding tasks.");
  snprintf(s_hint_text, sizeof(s_hint_text), "(Please wait)");
  update_display();
}

static void show_success(int count) {
  if (count == 1) {
    snprintf(s_main_text, sizeof(s_main_text), "Added 1 task!");
  } else {
    snprintf(s_main_text, sizeof(s_main_text), "Added %d tasks!", count);
  }
  snprintf(s_hint_text, sizeof(s_hint_text), "Select: Again");
  update_display();
}

static void show_error(const char *msg) {
  snprintf(s_main_text, sizeof(s_main_text), "%s", msg);
  snprintf(s_hint_text, sizeof(s_hint_text), "Select: Retry");
  update_display();
}

static void show_no_config(void) {
  snprintf(s_main_text, sizeof(s_main_text),
           "No API key.\n\nOpen the Pebble app to configure.");
  snprintf(s_hint_text, sizeof(s_hint_text), "Select: Settings");
  update_display();
}

// ---- Timer callbacks ----

static void return_to_idle_callback(void *context) {
  s_state_timer = NULL;
  set_state(STATE_IDLE);
}

static void cancel_state_timer(void) {
  if (s_state_timer) {
    app_timer_cancel(s_state_timer);
    s_state_timer = NULL;
  }
}

static void start_state_timer(int ms) {
  cancel_state_timer();
  s_state_timer = app_timer_register(ms, return_to_idle_callback, NULL);
}

static void ellipsis_tick_callback(void *context) {
  s_ellipsis_timer = NULL;
  if (s_current_state != STATE_PROCESSING) return;

  s_ellipsis_count = (s_ellipsis_count + 1) % 4;
  const char *dots[] = { "Adding tasks.", "Adding tasks..", "Adding tasks...", "Adding tasks." };
  snprintf(s_main_text, sizeof(s_main_text), "%s", dots[s_ellipsis_count]);
  text_layer_set_text(s_main_layer, s_main_text);

  s_ellipsis_timer = app_timer_register(600, ellipsis_tick_callback, NULL);
}

static void cancel_ellipsis_timer(void) {
  if (s_ellipsis_timer) {
    app_timer_cancel(s_ellipsis_timer);
    s_ellipsis_timer = NULL;
  }
}

static void auto_launch_callback(void *context) {
  if (s_current_state == STATE_RECORDING) {
    dictation_session_start(s_dictation_session);
  }
}

// ---- State machine ----

static void set_state(AppState state) {
  s_current_state = state;
  cancel_ellipsis_timer();

  switch (state) {
    case STATE_IDLE:
      show_idle();
      break;
    case STATE_RECORDING:
      show_recording();
      break;
    case STATE_PROCESSING:
      show_processing();
      s_ellipsis_count = 0;
      s_ellipsis_timer = app_timer_register(600, ellipsis_tick_callback, NULL);
      break;
    case STATE_PREVIEW:
      // Preview window is pushed on top; main window content is hidden
      break;
    case STATE_SUCCESS:
      // Caller provides count; hint already set; just start auto-return timer
      start_state_timer(4000);
      vibes_double_pulse();
      break;
    case STATE_ERROR:
      start_state_timer(4000);
      vibes_long_pulse();
      break;
    case STATE_NO_CONFIG:
      show_no_config();
      // No auto-return — user must configure
      break;
  }
}

// ---- AppMessage ----

static void send_dictation_text(const char *text) {
  DictionaryIterator *iter;
  AppMessageResult result = app_message_outbox_begin(&iter);
  if (result != APP_MSG_OK) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "Outbox begin failed: %d", (int)result);
    show_error("Phone comm error.");
    set_state(STATE_ERROR);
    return;
  }
  dict_write_cstring(iter, MESSAGE_KEY_DICTATION_TEXT, text);
  app_message_outbox_send();
  APP_LOG(APP_LOG_LEVEL_INFO, "Sent dictation text to phone: %s", text);
}

static void inbox_received_callback(DictionaryIterator *iterator, void *context) {
  APP_LOG(APP_LOG_LEVEL_INFO, "Inbox received");

  // Clay settings delivery
  Tuple *api_key_t = dict_find(iterator, MESSAGE_KEY_TodoistApiKey);
  if (api_key_t) {
    snprintf(s_api_key, sizeof(s_api_key), "%s", api_key_t->value->cstring);
    persist_write_string(STORAGE_KEY_API_KEY, s_api_key);
    APP_LOG(APP_LOG_LEVEL_INFO, "API key saved");
  }

  Tuple *project_id_t = dict_find(iterator, MESSAGE_KEY_TodoistProjectId);
  if (project_id_t) {
    snprintf(s_project_id, sizeof(s_project_id), "%s", project_id_t->value->cstring);
    persist_write_string(STORAGE_KEY_PROJECT_ID, s_project_id);
    APP_LOG(APP_LOG_LEVEL_INFO, "Project ID saved: %s", s_project_id);
  }

  Tuple *auto_launch_t = dict_find(iterator, MESSAGE_KEY_AutoLaunch);
  if (auto_launch_t) {
    s_auto_launch = auto_launch_t->value->uint8 != 0;
    persist_write_bool(STORAGE_KEY_AUTO_LAUNCH, s_auto_launch);
  }

  Tuple *skip_preview_t = dict_find(iterator, MESSAGE_KEY_SkipPreview);
  if (skip_preview_t) {
    s_skip_preview = skip_preview_t->value->uint8 != 0;
    persist_write_bool(STORAGE_KEY_SKIP_PREVIEW, s_skip_preview);
  }

  // Task preview from phone — show confirmation window
  Tuple *preview_t = dict_find(iterator, MESSAGE_KEY_TASK_PREVIEW);
  if (preview_t) {
    cancel_ellipsis_timer();
    snprintf(s_preview_text, sizeof(s_preview_text), "%s", preview_t->value->cstring);
    APP_LOG(APP_LOG_LEVEL_INFO, "Task preview received: %s", s_preview_text);
    s_preview_confirmed = false;
    preview_window_push();
    s_current_state = STATE_PREVIEW;
  }

  // Task creation result
  Tuple *success_t = dict_find(iterator, MESSAGE_KEY_RESULT_SUCCESS);
  if (success_t) {
    int count = (int)success_t->value->uint8;
    APP_LOG(APP_LOG_LEVEL_INFO, "Success: %d tasks added", count);
    show_success(count);
    set_state(STATE_SUCCESS);
  }

  Tuple *error_t = dict_find(iterator, MESSAGE_KEY_RESULT_ERROR);
  if (error_t) {
    const char *err = error_t->value->cstring;
    APP_LOG(APP_LOG_LEVEL_ERROR, "Error from phone: %s", err);
    show_error(err);
    // Check if it's an auth/config error — don't auto-dismiss those
    if (strstr(err, "API key") != NULL) {
      set_state(STATE_NO_CONFIG);
    } else {
      set_state(STATE_ERROR);
    }
  }
}

static void outbox_failed_callback(DictionaryIterator *iterator,
                                    AppMessageResult reason, void *context) {
  APP_LOG(APP_LOG_LEVEL_ERROR, "Outbox failed: %d", (int)reason);
  show_error("Phone comm error.");
  set_state(STATE_ERROR);
}

static void outbox_sent_callback(DictionaryIterator *iterator, void *context) {
  APP_LOG(APP_LOG_LEVEL_INFO, "Message sent to phone successfully");
}

// ---- Dictation ----

static void dictation_result_handler(DictationSession *session,
                                      DictationSessionStatus result,
                                      char *transcription,
                                      void *context) {
  APP_LOG(APP_LOG_LEVEL_INFO, "Dictation result: %d", (int)result);

  switch (result) {
    case DictationSessionStatusSuccess:
      APP_LOG(APP_LOG_LEVEL_INFO, "Dictation: %s", transcription);
      set_state(STATE_PROCESSING);
      send_dictation_text(transcription);
      break;

    case DictationSessionStatusFailureNoSpeechDetected:
      show_error("No speech detected.\nTry again.");
      set_state(STATE_ERROR);
      break;

    case DictationSessionStatusFailureConnectivityError:
      show_error("Check phone\nBluetooth connection.");
      set_state(STATE_ERROR);
      break;

    case DictationSessionStatusFailureRecognizerError:
      show_error("Transcription error.\nTry again.");
      set_state(STATE_ERROR);
      break;

    case DictationSessionStatusFailureDisabled:
      show_error("Dictation disabled.");
      set_state(STATE_ERROR);
      break;

    default:
      set_state(STATE_IDLE);
      break;
  }
}

// ---- Confirm tasks ----

static void send_confirm_tasks(void) {
  DictionaryIterator *iter;
  AppMessageResult result = app_message_outbox_begin(&iter);
  if (result != APP_MSG_OK) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "Outbox begin failed for confirm: %d", (int)result);
    return;
  }
  dict_write_uint8(iter, MESSAGE_KEY_CONFIRM_TASKS, 1);
  app_message_outbox_send();
  APP_LOG(APP_LOG_LEVEL_INFO, "CONFIRM_TASKS sent");
}

// ---- Preview window ----

static void preview_select_click_handler(ClickRecognizerRef recognizer, void *context) {
  s_preview_confirmed = true;
  window_stack_pop(true);
}

static void preview_click_config_provider(void *context) {
  window_single_click_subscribe(BUTTON_ID_SELECT, preview_select_click_handler);
}

static void preview_window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(root);
  int margin = PBL_IF_ROUND_ELSE(20, 4);
  int hint_h = PBL_IF_ROUND_ELSE(40, 36);

  // Build numbered task list from pipe-delimited s_preview_text
  static char display_buf[1100];
  static char temp[1024];
  display_buf[0] = '\0';
  snprintf(temp, sizeof(temp), "%s", s_preview_text);

  int task_num = 1;
  char *p = temp;
  while (*p != '\0') {
    char *end = p;
    while (*end != '|' && *end != '\0') end++;
    char saved = *end;
    *end = '\0';
    char line[128];
    snprintf(line, sizeof(line), "%d. %s\n", task_num++, p);
    strncat(display_buf, line, sizeof(display_buf) - strlen(display_buf) - 1);
    *end = saved;
    if (saved == '\0') break;
    p = end + 1;
  }
  int content_h = (task_num - 1) * 40 + 16;

  // Title bar
  s_preview_title_layer = text_layer_create(GRect(0, 0, bounds.size.w, 28));
  text_layer_set_background_color(s_preview_title_layer, GColorCobaltBlue);
  text_layer_set_text_color(s_preview_title_layer, GColorWhite);
  text_layer_set_font(s_preview_title_layer, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD));
  text_layer_set_text_alignment(s_preview_title_layer, GTextAlignmentCenter);
  text_layer_set_text(s_preview_title_layer, "Confirm Tasks?");
  layer_add_child(root, text_layer_get_layer(s_preview_title_layer));

  // Hint bar
  int hint_y = bounds.size.h - hint_h;
  s_preview_hint_layer = text_layer_create(
      GRect(margin, hint_y, bounds.size.w - margin * 2, hint_h));
  text_layer_set_background_color(s_preview_hint_layer, GColorClear);
  text_layer_set_text_color(s_preview_hint_layer, GColorDarkGray);
  text_layer_set_font(s_preview_hint_layer, fonts_get_system_font(FONT_KEY_GOTHIC_14));
  text_layer_set_text_alignment(s_preview_hint_layer, GTextAlignmentCenter);
  text_layer_set_text(s_preview_hint_layer, "Select: Add  Back: Cancel");
  layer_add_child(root, text_layer_get_layer(s_preview_hint_layer));

  // Scroll layer fills the middle zone
  GRect scroll_frame = GRect(0, 28, bounds.size.w, bounds.size.h - 28 - hint_h);
  s_preview_scroll_layer = scroll_layer_create(scroll_frame);

  // Text layer inside scroll
  s_preview_text_layer = text_layer_create(
      GRect(margin, 4, scroll_frame.size.w - margin * 2, content_h));
  text_layer_set_background_color(s_preview_text_layer, GColorClear);
  text_layer_set_text_color(s_preview_text_layer, GColorBlack);
  text_layer_set_font(s_preview_text_layer, fonts_get_system_font(FONT_KEY_GOTHIC_18));
  text_layer_set_text_alignment(s_preview_text_layer, GTextAlignmentLeft);
  text_layer_set_overflow_mode(s_preview_text_layer, GTextOverflowModeWordWrap);
  text_layer_set_text(s_preview_text_layer, display_buf);

  scroll_layer_set_content_size(s_preview_scroll_layer,
      GSize(scroll_frame.size.w, content_h + 8));
  scroll_layer_add_child(s_preview_scroll_layer,
      text_layer_get_layer(s_preview_text_layer));
  layer_add_child(root, scroll_layer_get_layer(s_preview_scroll_layer));

  // Give Up/Down to scroll layer; Select is wired in via scroll layer callbacks
  scroll_layer_set_callbacks(s_preview_scroll_layer, (ScrollLayerCallbacks){
    .click_config_provider = preview_click_config_provider
  });
  scroll_layer_set_click_config_onto_window(s_preview_scroll_layer, window);
}

static void preview_window_unload(Window *window) {
  text_layer_destroy(s_preview_text_layer);
  s_preview_text_layer = NULL;
  scroll_layer_destroy(s_preview_scroll_layer);
  s_preview_scroll_layer = NULL;
  text_layer_destroy(s_preview_hint_layer);
  s_preview_hint_layer = NULL;
  text_layer_destroy(s_preview_title_layer);
  s_preview_title_layer = NULL;

  window_destroy(s_preview_window);
  s_preview_window = NULL;

  if (s_preview_confirmed) {
    set_state(STATE_PROCESSING);
    send_confirm_tasks();
  } else {
    set_state(STATE_IDLE);
  }
}

static void preview_window_push(void) {
  if (s_preview_window != NULL) return;
  s_preview_window = window_create();
  window_set_window_handlers(s_preview_window, (WindowHandlers) {
    .load   = preview_window_load,
    .unload = preview_window_unload
  });
  window_stack_push(s_preview_window, true);
}

// ---- Button handlers ----

static void select_click_handler(ClickRecognizerRef recognizer, void *context) {
  switch (s_current_state) {
    case STATE_IDLE:
      if (s_api_key[0] == '\0') {
        set_state(STATE_NO_CONFIG);
        return;
      }
      set_state(STATE_RECORDING);
      dictation_session_start(s_dictation_session);
      break;

    case STATE_SUCCESS:
    case STATE_ERROR:
      cancel_state_timer();
      if (s_auto_launch && s_api_key[0] != '\0') {
        set_state(STATE_RECORDING);
        app_timer_register(100, auto_launch_callback, NULL);
      } else {
        set_state(STATE_IDLE);
      }
      break;

    case STATE_NO_CONFIG:
      // Back button exits; Select has no action here
      break;

    default:
      break;
  }
}

static void click_config_provider(void *context) {
  window_single_click_subscribe(BUTTON_ID_SELECT, select_click_handler);
}

// ---- Window lifecycle ----

static void window_load(Window *window) {
  Layer *window_layer = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(window_layer);

  // Title bar
  s_title_layer = text_layer_create(GRect(0, 0, bounds.size.w, 28));
  text_layer_set_background_color(s_title_layer, GColorCobaltBlue);
  text_layer_set_text_color(s_title_layer, GColorWhite);
  text_layer_set_font(s_title_layer, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD));
  text_layer_set_text_alignment(s_title_layer, GTextAlignmentCenter);
  text_layer_set_text(s_title_layer, "Todoist Ramble");
  layer_add_child(window_layer, text_layer_get_layer(s_title_layer));

  // Main content area
  int main_y = 36;
  int hint_h = PBL_IF_ROUND_ELSE(40, 44);
  int divider_y = bounds.size.h - hint_h - 1;
  int main_h = divider_y - main_y - 4;
  int margin = PBL_IF_ROUND_ELSE(20, 8);

  s_main_layer = text_layer_create(
      GRect(margin, main_y, bounds.size.w - margin * 2, main_h));
  text_layer_set_background_color(s_main_layer, GColorClear);
  text_layer_set_text_color(s_main_layer, GColorBlack);
  text_layer_set_font(s_main_layer, fonts_get_system_font(FONT_KEY_GOTHIC_18));
  text_layer_set_text_alignment(s_main_layer, GTextAlignmentCenter);
  text_layer_set_overflow_mode(s_main_layer, GTextOverflowModeWordWrap);
  layer_add_child(window_layer, text_layer_get_layer(s_main_layer));

  // Divider line
  s_divider_layer = layer_create(GRect(0, divider_y, bounds.size.w, 1));
  layer_set_update_proc(s_divider_layer, divider_update_proc);
  layer_add_child(window_layer, s_divider_layer);

  // Hint bar
  s_hint_layer = text_layer_create(
      GRect(margin, divider_y + 2, bounds.size.w - margin * 2, hint_h - 2));
  text_layer_set_background_color(s_hint_layer, GColorClear);
  text_layer_set_text_color(s_hint_layer, GColorDarkGray);
  text_layer_set_font(s_hint_layer, fonts_get_system_font(FONT_KEY_GOTHIC_14));
  text_layer_set_text_alignment(s_hint_layer, GTextAlignmentCenter);
  layer_add_child(window_layer, text_layer_get_layer(s_hint_layer));

  // Set initial state — skip idle if quick launch is enabled
  if (s_auto_launch && s_api_key[0] != '\0') {
    set_state(STATE_RECORDING);
    app_timer_register(100, auto_launch_callback, NULL);
  } else {
    set_state(STATE_IDLE);
  }
}

static void window_unload(Window *window) {
  cancel_state_timer();
  cancel_ellipsis_timer();
  text_layer_destroy(s_title_layer);
  text_layer_destroy(s_main_layer);
  text_layer_destroy(s_hint_layer);
  layer_destroy(s_divider_layer);
}

// ---- Init / deinit ----

static void init(void) {
  // Load persisted settings
  s_api_key[0] = '\0';
  s_project_id[0] = '\0';
  if (persist_exists(STORAGE_KEY_API_KEY)) {
    persist_read_string(STORAGE_KEY_API_KEY, s_api_key, sizeof(s_api_key));
  }
  if (persist_exists(STORAGE_KEY_PROJECT_ID)) {
    persist_read_string(STORAGE_KEY_PROJECT_ID, s_project_id, sizeof(s_project_id));
  }
  if (persist_exists(STORAGE_KEY_AUTO_LAUNCH)) {
    s_auto_launch = persist_read_bool(STORAGE_KEY_AUTO_LAUNCH);
  }
  if (persist_exists(STORAGE_KEY_SKIP_PREVIEW)) {
    s_skip_preview = persist_read_bool(STORAGE_KEY_SKIP_PREVIEW);
  }

  // Create dictation session — 512 byte buffer for transcription
  s_dictation_session = dictation_session_create(512, dictation_result_handler, NULL);

  // AppMessage — register callbacks BEFORE open
  app_message_register_inbox_received(inbox_received_callback);
  app_message_register_outbox_failed(outbox_failed_callback);
  app_message_register_outbox_sent(outbox_sent_callback);
  app_message_open(1024, 576);

  // Window
  s_main_window = window_create();
  window_set_window_handlers(s_main_window, (WindowHandlers) {
    .load = window_load,
    .unload = window_unload
  });
  window_set_click_config_provider(s_main_window, click_config_provider);
  window_stack_push(s_main_window, true);
}

static void deinit(void) {
  if (s_dictation_session) {
    dictation_session_destroy(s_dictation_session);
    s_dictation_session = NULL;
  }
  window_destroy(s_main_window);
}

int main(void) {
  init();
  app_event_loop();
  deinit();
  return 0;
}
