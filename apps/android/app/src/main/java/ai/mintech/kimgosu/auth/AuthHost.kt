package ai.mintech.kimgosu.auth

import android.content.Intent
import android.provider.Settings
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import ai.mintech.kimgosu.auth.ui.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun AuthHost(model: AuthModel, home: @Composable () -> Unit) {
    val context = LocalContext.current
    val holder = rememberSaveableStateHolder()
    val emit: (AuthEvent) -> Unit = { event ->
        if (event.action == AuthAction.OPEN_OS_SETTINGS) {
            context.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName))
        } else model.handle(event)
    }
    LaunchedEffect(Unit) { model.start() }
    val owner = context as? androidx.lifecycle.LifecycleOwner
    DisposableEffect(owner) {
        val observer = androidx.lifecycle.LifecycleEventObserver { _, event ->
            if (event == androidx.lifecycle.Lifecycle.Event.ON_RESUME) { model.refreshPolicy(); model.setOsPermission(
                if (androidx.core.app.NotificationManagerCompat.from(context).areNotificationsEnabled()) "허용" else "미허용") }
        }
        owner?.lifecycle?.addObserver(observer)
        onDispose { owner?.lifecycle?.removeObserver(observer) }
    }
    val top = model.stack.lastOrNull()
    val kind = top?.let { AuthSurfaces.getValue(it).kind }
    Box(Modifier.fillMaxSize().background(Color.White)) {
        // Keep A1 mounted behind auth so selection, scroll, and pending draft references survive cancel.
        if (model.browsing) home()
        val page = if (kind in listOf("sheet", "modal")) model.stack.dropLast(1).lastOrNull() else top
        page?.let { screen -> holder.SaveableStateProvider("page-${screen.name}") {
            KGAuthView(model.state.copy(screen = screen, busy = if (top == screen) model.state.busy else false,
                error = if (top == screen) model.state.error else ""), emit, Modifier.safeDrawingPadding())
        } }
        if (top != null && kind == "sheet") {
            ModalBottomSheet(onDismissRequest = model::back, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
                holder.SaveableStateProvider("overlay-${top.name}") {
                    KGAuthView(model.state, emit, Modifier.fillMaxWidth().heightIn(max = 640.dp))
                }
            }
        } else if (top != null && kind == "modal") {
            Dialog(onDismissRequest = model::back, properties = DialogProperties(usePlatformDefaultWidth = false)) {
                holder.SaveableStateProvider("overlay-${top.name}") {
                    KGAuthView(model.state, emit, Modifier.fillMaxWidth().padding(16.dp).heightIn(max = 580.dp))
                }
            }
        }
    }
    // OS permission is a separate fact; it never writes marketing consent/preferences.
    LaunchedEffect(top) {
        model.setOsPermission(if (androidx.core.app.NotificationManagerCompat.from(context).areNotificationsEnabled()) "허용" else "미허용")
    }
}
