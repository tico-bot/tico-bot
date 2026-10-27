package com.example.zeca.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Typeface
import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.scaleIn
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.animation.Crossfade
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AccountBalanceWallet
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material3.Button
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import coil.compose.AsyncImage
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.example.zeca.MensagemChat
import com.example.zeca.ConversaChat
import com.example.zeca.Movimento
import com.example.zeca.JogadorRanking
import com.example.zeca.JogadorDestino
import com.example.zeca.ResultadoTransferencia
import com.example.zeca.ui.theme.Cores
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import java.io.File
import java.io.FileOutputStream
import java.math.BigDecimal
import java.math.RoundingMode
import java.text.NumberFormat
import java.util.Locale
import java.util.UUID

@Composable
fun TelaConfigurarPerfil(
    nomeInicial: String,
    avatarUrlInicial: String,
    onEnviarFoto: (Uri, (String?, String?) -> Unit) -> Unit,
    onSalvarPerfil: (String, String, String, Boolean, (String?) -> Unit) -> Unit,
) {
    var username by rememberSaveable { mutableStateOf("") }
    var displayName by rememberSaveable { mutableStateOf(nomeInicial) }
    var avatarUrl by rememberSaveable { mutableStateOf(avatarUrlInicial) }
    var avatarComoFoto by rememberSaveable { mutableStateOf(false) }
    var mensagem by rememberSaveable { mutableStateOf("") }
    var enviandoFoto by remember { mutableStateOf(false) }
    var salvando by remember { mutableStateOf(false) }
    val seletorFoto = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) {
            enviandoFoto = true
            mensagem = "Enviando foto..."
            onEnviarFoto(uri) { url, erro ->
                enviandoFoto = false
                if (erro == null && url != null) {
                    avatarUrl = url
                    mensagem = "Foto atualizada."
                } else mensagem = erro ?: "Não foi possível enviar a foto."
            }
        }
    }
    val usernameValido = Regex("^[a-z0-9_]{3,20}$").matches(username)
    val nomeValido = displayName.trim().length in 2..24

    TelaBase("Seu perfil", "Escolha sua identidade no Zeca para continuar.") {
        GlassCard {
            Column(
                modifier = Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                AvatarComMoldura(
                    displayName.take(1).uppercase().ifBlank { "?" },
                    "",
                    92.dp,
                    photoUrl = avatarUrl,
                    avatarAsProfilePhoto = avatarComoFoto,
                )
                Button(
                    onClick = { seletorFoto.launch("image/*") },
                    enabled = !enviandoFoto,
                ) { Text(if (enviandoFoto) "Enviando foto..." else "Escolher foto de perfil") }
            }
            OutlinedTextField(
                value = username,
                onValueChange = { value ->
                    username = value.filter { it in 'a'..'z' || it in 'A'..'Z' || it in '0'..'9' || it == '_' }
                        .lowercase().take(20)
                    mensagem = ""
                },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Nome de usuário") },
                prefix = { Text("@") },
                supportingText = { Text("3 a 20 caracteres: letras, números e _") },
                singleLine = true,
            )
            OutlinedTextField(
                value = displayName,
                onValueChange = { displayName = it.take(24); mensagem = "" },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Nome de exibição") },
                supportingText = { Text("Este nome aparecerá no ranking e no chat.") },
                singleLine = true,
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = avatarComoFoto, onCheckedChange = { avatarComoFoto = it })
                Column {
                    Text("Usar meu avatar como foto de perfil", color = Color.White, fontSize = 12.sp)
                    Text("Seu personagem aparecerá no ranking e no chat.", color = Color.White.copy(alpha = 0.58f), fontSize = 10.sp)
                }
            }
            Button(
                onClick = {
                    salvando = true
                    mensagem = ""
                    onSalvarPerfil(username, displayName.trim(), avatarUrl, avatarComoFoto) { erro ->
                        salvando = false
                        mensagem = erro ?: "Perfil salvo."
                    }
                },
                enabled = usernameValido && nomeValido && !salvando && !enviandoFoto,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = Cores.Verde),
            ) { Text(if (salvando) "Salvando..." else "Salvar e continuar") }
            if (mensagem.isNotBlank()) {
                Text(mensagem, color = if (mensagem == "Perfil salvo." || mensagem == "Foto atualizada.") Cores.Verde else Cores.Laranja, fontSize = 12.sp)
            }
            Text("O nome de usuário é exclusivo. A foto é opcional e pode ser alterada depois.", color = Color.White.copy(alpha = 0.58f), fontSize = 11.sp)
        }
    }
}

fun formatarReais(centavos: Long): String =
    NumberFormat.getCurrencyInstance(Locale.forLanguageTag("pt-BR")).format(BigDecimal.valueOf(centavos, 2))

private data class ComprovantePix(
    val id: String,
    val contraparte: String,
    val valorCentavos: Long,
    val horario: String,
    val recebimento: Boolean,
    val saldoAposCentavos: Long? = null,
)

private fun criarQrCode(conteudo: String): Bitmap? = runCatching {
    val matriz = QRCodeWriter().encode(conteudo, BarcodeFormat.QR_CODE, 640, 640)
    Bitmap.createBitmap(matriz.width, matriz.height, Bitmap.Config.ARGB_8888).apply {
        for (y in 0 until matriz.height) {
            for (x in 0 until matriz.width) {
                setPixel(x, y, if (matriz[x, y]) android.graphics.Color.BLACK else android.graphics.Color.WHITE)
            }
        }
    }
}.getOrNull()

private fun compartilharComprovanteImagem(context: android.content.Context, recibo: ComprovantePix) {
    val bitmap = Bitmap.createBitmap(1080, 1350, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    canvas.drawColor(android.graphics.Color.rgb(10, 16, 18))
    val painel = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = android.graphics.Color.rgb(27, 36, 39) }
    canvas.drawRoundRect(44f, 44f, 1036f, 1306f, 42f, 42f, painel)

    fun drawText(value: String, y: Float, size: Float, color: Int, bold: Boolean = false) {
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            this.color = color
            textSize = size
            typeface = if (bold) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
        }
        var visibleText = value
        while (visibleText.isNotEmpty() && paint.measureText(visibleText) > 840f) {
            visibleText = visibleText.dropLast(2) + "…"
        }
        canvas.drawText(visibleText, 112f, y, paint)
    }

    val green = android.graphics.Color.rgb(61, 220, 151)
    val white = android.graphics.Color.rgb(245, 248, 248)
    val muted = android.graphics.Color.rgb(170, 184, 186)
    drawText("ZECA · COMPROVANTE", 150f, 36f, green, true)
    drawText(if (recibo.recebimento) "Recebimento concluído" else "Pagamento concluído", 265f, 52f, white, true)
    drawText(formatarReais(recibo.valorCentavos), 430f, 82f, white, true)
    canvas.drawRect(112f, 500f, 968f, 503f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = android.graphics.Color.rgb(66, 82, 85) })
    drawText(if (recibo.recebimento) "RECEBIDO DE" else "ENVIADO PARA", 580f, 25f, muted, true)
    drawText(recibo.contraparte, 630f, 36f, white)
    drawText("ORIGEM / DESTINO", 735f, 25f, muted, true)
    drawText(if (recibo.recebimento) "Carteira Zeca" else "Seu saldo Zeca", 785f, 34f, white)
    drawText("DATA", 890f, 25f, muted, true)
    drawText(recibo.horario, 940f, 34f, white)
    drawText("IDENTIFICADOR", 1045f, 25f, muted, true)
    drawText(recibo.id, 1095f, 29f, white)
    recibo.saldoAposCentavos?.let { drawText("Saldo após: ${formatarReais(it)}", 1170f, 28f, green, true) }
    drawText("Saldo interno do Zeca · não é liquidação bancária Pix", 1250f, 23f, muted)

    val directory = File(context.cacheDir, "receipts").apply { mkdirs() }
    val file = File(directory, "receipt-${UUID.randomUUID()}.png")
    FileOutputStream(file).use { output -> bitmap.compress(Bitmap.CompressFormat.PNG, 100, output) }
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
    val shareIntent = Intent(Intent.ACTION_SEND).apply {
        type = "image/png"
        putExtra(Intent.EXTRA_STREAM, uri)
        putExtra(Intent.EXTRA_TEXT, "Comprovante Zeca · ${formatarReais(recibo.valorCentavos)}")
        clipData = android.content.ClipData.newUri(context.contentResolver, "Comprovante Zeca", uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    context.startActivity(Intent.createChooser(shareIntent, "Compartilhar comprovante"))
}

@Composable
fun TelaCarteira(
    linkPagamentoRecebido: String,
    onLinkPagamentoRecebido: () -> Unit,
    saldoCentavos: Long,
    chavePix: String,
    tipoChavePix: String,
    historico: List<Movimento>,
    emailConta: String,
    emailVerificadoInicial: Boolean,
    onReenviarVerificacao: ((String?) -> Unit) -> Unit,
    onConferirVerificacao: ((Boolean, String?) -> Unit) -> Unit,
    onSalvarChave: (String, String, (String?) -> Unit) -> Unit,
    onBuscarDestinatario: (String, (JogadorDestino?, String?) -> Unit) -> Unit,
    onTransferir: (String, Long, String, (ResultadoTransferencia?, String?) -> Unit) -> Unit,
) {
    val context = LocalContext.current
    var areaCarteira by rememberSaveable { mutableStateOf("Cobrar") }
    var tipoEdicao by rememberSaveable { mutableStateOf(tipoChavePix.ifBlank { "E-mail" }) }
    var chaveEditavel by rememberSaveable { mutableStateOf(chavePix) }
    var mensagem by rememberSaveable { mutableStateOf("") }
    var chaveDestinatario by rememberSaveable { mutableStateOf("") }
    var valorTransferencia by rememberSaveable { mutableStateOf("10,00") }
    var mensagemTransferencia by rememberSaveable { mutableStateOf("") }
    var destinatario by remember { mutableStateOf<JogadorDestino?>(null) }
    var transferenciaOcupada by remember { mutableStateOf(false) }
    var valorCobranca by rememberSaveable { mutableStateOf("") }
    var mostrarQr by rememberSaveable { mutableStateOf(false) }
    var mensagemQr by rememberSaveable { mutableStateOf("") }
    var comprovante by remember { mutableStateOf<ComprovantePix?>(null) }
    var emailVerificado by remember { mutableStateOf(emailVerificadoInicial) }
    var mensagemVerificacao by rememberSaveable { mutableStateOf("") }
    var verificacaoOcupada by remember { mutableStateOf(false) }
    val chaveValida = when (tipoEdicao) {
        "E-mail" -> Regex("^[A-Za-z0-9+_.-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$").matches(chaveEditavel.trim())
        else -> Regex("^[A-Fa-f0-9]{32}$").matches(chaveEditavel.trim())
    }
    val valorQrCentavos = if (valorCobranca.isBlank()) null else parseValorCentavos(valorCobranca)
    val valorQrInvalido = valorCobranca.isNotBlank()
        && (valorQrCentavos == null || valorQrCentavos !in 1..1_000_000)
    val conteudoQr = remember(chavePix, valorQrCentavos) {
        Uri.Builder()
            .scheme("zeca")
            .authority("pix")
            .appendQueryParameter("key", chavePix)
            .apply { valorQrCentavos?.let { appendQueryParameter("amount", it.toString()) } }
            .build()
            .toString()
    }
    val imagemQr = remember(conteudoQr, mostrarQr) {
        if (mostrarQr && chavePix.isNotBlank()) criarQrCode(conteudoQr) else null
    }

    fun buscarDestinatario(chave: String) {
        transferenciaOcupada = true
        mensagemTransferencia = ""
        onBuscarDestinatario(chave) { encontrado, erro ->
            transferenciaOcupada = false
            destinatario = encontrado
            mensagemTransferencia = erro
                ?: if (encontrado != null) "Confira o destinatário antes de continuar." else "Conta não encontrada."
        }
    }

    fun lerQrCode() {
        GmsBarcodeScanning.getClient(context).startScan()
            .addOnSuccessListener { codigo ->
                val uri = runCatching { Uri.parse(codigo.rawValue.orEmpty()) }.getOrNull()
                val chave = uri?.getQueryParameter("key").orEmpty()
                val valor = uri?.getQueryParameter("amount")?.toLongOrNull()
                if (uri?.scheme != "zeca" || uri.host != "pix" || chave.isBlank()
                    || (uri.getQueryParameter("amount") != null && (valor == null || valor <= 0L))) {
                    mensagemTransferencia = "QR inválido. Use um QR de cobrança do Zeca."
                } else {
                    chaveDestinatario = chave
                    destinatario = null
                    valor?.let { valorTransferencia = BigDecimal.valueOf(it, 2).toPlainString().replace('.', ',') }
                    buscarDestinatario(chave)
                }
            }
            .addOnFailureListener { mensagemTransferencia = "Não foi possível ler o QR code. Tente novamente." }
    }

    LaunchedEffect(linkPagamentoRecebido) {
        if (linkPagamentoRecebido.isBlank()) return@LaunchedEffect
        val uri = runCatching { Uri.parse(linkPagamentoRecebido) }.getOrNull()
        val chave = uri?.getQueryParameter("key").orEmpty()
        val amountParameter = uri?.getQueryParameter("amount")
        val valor = amountParameter?.toLongOrNull()
        if (uri?.scheme != "zeca" || uri.host != "pix" || chave.isBlank()
            || (amountParameter != null && (valor == null || valor !in 1..1_000_000))) {
            areaCarteira = "Enviar"
            mensagemTransferencia = "Link de pagamento inválido."
        } else {
            areaCarteira = "Enviar"
            chaveDestinatario = chave
            destinatario = null
            valor?.let { valorTransferencia = BigDecimal.valueOf(it, 2).toPlainString().replace('.', ',') }
            buscarDestinatario(chave)
        }
        onLinkPagamentoRecebido()
    }

    TelaBase("Carteira", "Saldo e movimentações.") {
        GlassCard {
            Text("SALDO DISPONÍVEL", color = Color.White.copy(alpha = 0.62f), fontSize = 11.sp, fontWeight = FontWeight.Bold)
            Text(formatarReais(saldoCentavos), color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.Black)
        }

        Opcoes(listOf("Cobrar", "Enviar", "Histórico", "Chave Pix"), areaCarteira) { areaCarteira = it }

        when (areaCarteira) {
            "Cobrar" -> GlassCard {
                Text("Criar cobrança", color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                Text(
                    "QR e link para transferências entre saldos do Zeca. Não é um Pix bancário.",
                    color = Color.White.copy(alpha = 0.65f),
                    fontSize = 12.sp,
                )
                OutlinedTextField(
                    value = valorCobranca,
                    onValueChange = { valorCobranca = it; mensagemQr = ""; mostrarQr = false },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Valor fixo (opcional)") },
                    prefix = { Text("R$ ") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                )
                Button(
                    onClick = {
                        mostrarQr = !valorQrInvalido
                        mensagemQr = if (valorQrInvalido) {
                            "Informe um valor entre R$ 0,01 e R$ 10.000,00."
                        } else ""
                    },
                    enabled = chavePix.isNotBlank(),
                    modifier = Modifier.fillMaxWidth(),
                ) { Text(if (mostrarQr) "Atualizar cobrança" else "Criar cobrança") }
                if (imagemQr != null) {
                    Image(
                        bitmap = imagemQr.asImageBitmap(),
                        contentDescription = "QR code de cobrança interna do Zeca",
                        modifier = Modifier.align(Alignment.CenterHorizontally).size(220.dp),
                    )
                    Text("Chave: $chavePix", color = Color.White.copy(alpha = 0.7f), fontSize = 12.sp)
                    valorQrCentavos?.let {
                        Text("Valor: ${formatarReais(it)}", color = Cores.Verde, fontWeight = FontWeight.Bold)
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Button(
                            onClick = {
                                val clipboard = context.getSystemService(ClipboardManager::class.java)
                                clipboard?.setPrimaryClip(ClipData.newPlainText("Link de pagamento Zeca", conteudoQr))
                                Toast.makeText(context, "Link de pagamento copiado", Toast.LENGTH_SHORT).show()
                            },
                            modifier = Modifier.weight(1f),
                        ) { Text("Copiar link") }
                        Button(
                            onClick = {
                                val texto = buildString {
                                    append("Cobrança Zeca")
                                    valorQrCentavos?.let { append(" · ${formatarReais(it)}") }
                                    append("\n$conteudoQr")
                                }
                                val shareIntent = Intent(Intent.ACTION_SEND).apply {
                                    type = "text/plain"
                                    putExtra(Intent.EXTRA_TEXT, texto)
                                }
                                context.startActivity(Intent.createChooser(shareIntent, "Compartilhar cobrança"))
                            },
                            modifier = Modifier.weight(1f),
                        ) { Text("Compartilhar") }
                    }
                }
                if (mensagemQr.isNotBlank()) Text(mensagemQr, color = Cores.Laranja, fontSize = 12.sp)
                if (chavePix.isBlank()) {
                    Text("Cadastre uma chave para criar sua cobrança.", color = Cores.Laranja, fontSize = 12.sp)
                    Button(onClick = { areaCarteira = "Chave Pix" }, modifier = Modifier.fillMaxWidth()) {
                        Text("Cadastrar chave Pix")
                    }
                }
            }

            "Enviar" -> GlassCard {
                Text("Enviar para um usuário", color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                Button(onClick = ::lerQrCode, modifier = Modifier.fillMaxWidth()) { Text("Ler QR code") }
                OutlinedTextField(
                    value = chaveDestinatario,
                    onValueChange = { chaveDestinatario = it; destinatario = null; mensagemTransferencia = "" },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("E-mail ou chave aleatória") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                )
                Button(
                    onClick = { buscarDestinatario(chaveDestinatario.trim()) },
                    enabled = chaveDestinatario.isNotBlank() && !transferenciaOcupada,
                    modifier = Modifier.fillMaxWidth(),
                ) { Text(if (transferenciaOcupada) "Buscando..." else "Buscar usuário") }
                destinatario?.let { jogador ->
                    Text("${jogador.apelido} · Nível ${jogador.nivel}", color = Cores.Turquesa, fontWeight = FontWeight.Bold)
                    OutlinedTextField(
                        value = valorTransferencia,
                        onValueChange = { valorTransferencia = it; mensagemTransferencia = "" },
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("Valor da transferência") },
                        prefix = { Text("R$ ") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    )
                    val valorEnvio = parseValorCentavos(valorTransferencia)
                    Button(
                        onClick = {
                            val valor = valorEnvio ?: return@Button
                            transferenciaOcupada = true
                            onTransferir(chaveDestinatario.trim(), valor, UUID.randomUUID().toString()) { resultado, erro ->
                                transferenciaOcupada = false
                                if (erro == null && resultado != null) {
                                    comprovante = ComprovantePix(
                                        id = resultado.id,
                                        contraparte = resultado.nomeDestino,
                                        valorCentavos = valor,
                                        horario = java.text.SimpleDateFormat("dd/MM/yyyy HH:mm", Locale.forLanguageTag("pt-BR"))
                                            .format(java.util.Date()),
                                        recebimento = false,
                                        saldoAposCentavos = resultado.saldoCentavos,
                                    )
                                    destinatario = null
                                    mensagemTransferencia = "Transferência concluída para ${resultado.nomeDestino}."
                                    chaveDestinatario = ""
                                } else {
                                    mensagemTransferencia = erro ?: "Não foi possível concluir a transferência."
                                }
                            }
                        },
                        enabled = valorEnvio != null && valorEnvio > 0 && !transferenciaOcupada,
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text(if (transferenciaOcupada) "Enviando..." else "Confirmar envio") }
                }
                if (mensagemTransferencia.isNotBlank()) {
                    Text(
                        mensagemTransferencia,
                        color = if (mensagemTransferencia.contains("encontrada") || mensagemTransferencia.contains("inválido")) {
                            Cores.Laranja
                        } else Cores.Verde,
                        fontSize = 13.sp,
                    )
                }
                Text("A transferência é entre saldos do Zeca; não movimenta valores bancários.", color = Color.White.copy(alpha = 0.58f), fontSize = 11.sp)
            }

            "Histórico" -> GlassCard {
                Text("Movimentações", color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                if (historico.isEmpty()) {
                    Text("Nenhuma movimentação por enquanto.", color = Color.White.copy(alpha = 0.65f), fontSize = 13.sp)
                } else {
                    historico.take(8).forEach { movimento ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .then(if (movimento.ehTransferenciaPix) Modifier.clickable {
                                    comprovante = ComprovantePix(
                                        id = movimento.id,
                                        contraparte = movimento.titulo,
                                        valorCentavos = kotlin.math.abs(movimento.variacaoCentavos),
                                        horario = movimento.horario,
                                        recebimento = movimento.variacaoCentavos > 0,
                                    )
                                } else Modifier),
                            horizontalArrangement = Arrangement.SpaceBetween,
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(movimento.titulo, color = Color.White, fontSize = 14.sp)
                                Text(movimento.horario, color = Color.White.copy(alpha = 0.52f), fontSize = 11.sp)
                            }
                            Text(
                                (if (movimento.variacaoCentavos >= 0) "+" else "-") + formatarReais(kotlin.math.abs(movimento.variacaoCentavos)),
                                color = if (movimento.variacaoCentavos >= 0) Cores.Verde else Color(0xFFFF8790),
                                fontWeight = FontWeight.Bold,
                                fontSize = 13.sp,
                            )
                        }
                    }
                }
            }

            else -> GlassCard {
                Text("Minha chave Pix", color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                if (chavePix.isNotBlank()) {
                    Text("${tipoChavePix}: $chavePix", color = Color.White.copy(alpha = 0.76f), fontSize = 13.sp)
                    TextButton(onClick = {
                        val clipboard = context.getSystemService(ClipboardManager::class.java)
                        clipboard?.setPrimaryClip(ClipData.newPlainText("Chave Pix do Zeca", chavePix))
                        Toast.makeText(context, "Chave copiada", Toast.LENGTH_SHORT).show()
                    }) { Text("Copiar chave") }
                } else {
                    Text("Cadastre um e-mail ou gere uma chave aleatória.", color = Color.White.copy(alpha = 0.68f), fontSize = 13.sp)
                }

                Opcoes(listOf("E-mail", "Aleatória"), tipoEdicao) { novoTipo ->
                    tipoEdicao = novoTipo
                    chaveEditavel = if (novoTipo == tipoChavePix) chavePix else ""
                    mensagem = ""
                }
                if (tipoEdicao == "E-mail") {
                    OutlinedTextField(
                        value = chaveEditavel,
                        onValueChange = { chaveEditavel = it; mensagem = "" },
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("E-mail da chave") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                    )
                    if (emailVerificado) {
                        Text("E-mail da conta verificado.", color = Cores.Verde, fontSize = 12.sp)
                    } else {
                        Text(
                            "Verifique o e-mail da conta ($emailConta) para cadastrá-lo como chave Pix.",
                            color = Cores.Laranja,
                            fontSize = 12.sp,
                        )
                        Button(
                            onClick = {
                                verificacaoOcupada = true
                                mensagemVerificacao = ""
                                onReenviarVerificacao { erro ->
                                    verificacaoOcupada = false
                                    mensagemVerificacao = erro ?: "Enviamos o link de verificação para $emailConta."
                                }
                            },
                            enabled = !verificacaoOcupada,
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text("Reenviar e-mail de verificação") }
                        Button(
                            onClick = {
                                verificacaoOcupada = true
                                mensagemVerificacao = ""
                                onConferirVerificacao { verificado, erro ->
                                    verificacaoOcupada = false
                                    if (verificado) emailVerificado = true
                                    mensagemVerificacao = erro
                                        ?: if (verificado) "E-mail verificado." else "Ainda não verificado. Abra o link enviado ao seu e-mail."
                                }
                            },
                            enabled = !verificacaoOcupada,
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text("Já verifiquei") }
                        if (mensagemVerificacao.isNotBlank()) {
                            Text(mensagemVerificacao, color = Color.White.copy(alpha = 0.76f), fontSize = 12.sp)
                        }
                    }
                } else {
                    OutlinedTextField(
                        value = chaveEditavel,
                        onValueChange = { chaveEditavel = it; mensagem = "" },
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("Chave aleatória") },
                        readOnly = true,
                        singleLine = true,
                    )
                    TextButton(onClick = {
                        chaveEditavel = UUID.randomUUID().toString().replace("-", "")
                        mensagem = ""
                    }) { Text("Gerar chave aleatória") }
                }
                Button(
                    onClick = {
                        onSalvarChave(tipoEdicao, chaveEditavel.trim()) { erro ->
                            mensagem = erro ?: "Chave salva."
                        }
                    },
                    enabled = chaveValida && (tipoEdicao != "E-mail" || emailVerificado),
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Salvar chave") }
                if (mensagem.isNotBlank()) Text(mensagem, color = Cores.Verde, fontSize = 13.sp)
            }
        }
    }

    comprovante?.let { recibo ->
        Dialog(
            onDismissRequest = { comprovante = null },
            properties = DialogProperties(usePlatformDefaultWidth = false),
        ) {
            AnimatedVisibility(visible = true, enter = scaleIn() + fadeIn()) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth(0.94f)
                        .heightIn(max = 680.dp)
                        .clip(RoundedCornerShape(28.dp))
                        .background(
                            Brush.verticalGradient(listOf(Color(0xFF222A2E), Cores.Cartao, Cores.Fundo)),
                        )
                        .border(1.dp, Color.White.copy(alpha = 0.17f), RoundedCornerShape(28.dp))
                        .verticalScroll(rememberScrollState())
                        .padding(22.dp),
                    verticalArrangement = Arrangement.spacedBy(18.dp),
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.Top,
                    ) {
                        Row(
                            modifier = Modifier.weight(1f),
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(48.dp)
                                    .clip(CircleShape)
                                    .background(Cores.Verde.copy(alpha = 0.14f)),
                                contentAlignment = Alignment.Center,
                            ) {
                                Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = Cores.Verde, modifier = Modifier.size(30.dp))
                            }
                            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                Text("ZECA · COMPROVANTE", color = Cores.Verde, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                                Text(
                                    if (recibo.recebimento) "Recebimento concluído" else "Pagamento concluído",
                                    color = Color.White,
                                    fontSize = 18.sp,
                                    fontWeight = FontWeight.Bold,
                                )
                            }
                        }
                        IconButton(onClick = { comprovante = null }) {
                            Icon(Icons.Filled.Close, contentDescription = "Fechar comprovante", tint = Color.White.copy(alpha = 0.72f))
                        }
                    }

                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(20.dp))
                            .background(Color.White.copy(alpha = 0.055f))
                            .padding(horizontal = 18.dp, vertical = 16.dp),
                        verticalArrangement = Arrangement.spacedBy(5.dp),
                    ) {
                        Text("VALOR DA TRANSFERÊNCIA", color = Color.White.copy(alpha = 0.56f), fontSize = 10.sp, fontWeight = FontWeight.Bold)
                        Text(
                            formatarReais(recibo.valorCentavos),
                            color = Color.White,
                            fontSize = 34.sp,
                            fontWeight = FontWeight.Black,
                        )
                        Text("Concluída · ${recibo.horario}", color = Cores.Verde, fontSize = 12.sp)
                    }

                    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                        LinhaComprovante(
                            rotulo = if (recibo.recebimento) "Recebido de" else "Enviado para",
                            valor = recibo.contraparte,
                        )
                        LinhaComprovante(
                            rotulo = if (recibo.recebimento) "Destino" else "Origem",
                            valor = if (recibo.recebimento) "Carteira Zeca" else "Seu saldo Zeca",
                            iconeCarteira = true,
                        )
                        LinhaComprovante(rotulo = "Tipo", valor = "Transferência entre usuários")
                        LinhaComprovante(rotulo = "Status", valor = "Concluída", valorVerde = true)
                        recibo.saldoAposCentavos?.let {
                            LinhaComprovante(rotulo = "Saldo após o envio", valor = formatarReais(it))
                        }
                    }

                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(16.dp))
                            .background(Color.Black.copy(alpha = 0.2f))
                            .padding(14.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text("IDENTIFICADOR", color = Color.White.copy(alpha = 0.52f), fontSize = 9.sp, fontWeight = FontWeight.Bold)
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                recibo.id,
                                modifier = Modifier.weight(1f),
                                color = Color.White.copy(alpha = 0.82f),
                                fontSize = 11.sp,
                            )
                            IconButton(onClick = {
                                context.getSystemService(ClipboardManager::class.java)
                                    ?.setPrimaryClip(ClipData.newPlainText("ID do comprovante Zeca", recibo.id))
                                Toast.makeText(context, "Identificador copiado", Toast.LENGTH_SHORT).show()
                            }) {
                                Icon(Icons.Filled.ContentCopy, contentDescription = "Copiar identificador", tint = Cores.Turquesa)
                            }
                        }
                    }

                    Text(
                        "Movimentação de saldo interno do Zeca. Este comprovante não representa uma liquidação bancária Pix.",
                        color = Cores.Laranja,
                        fontSize = 11.sp,
                    )

                    Button(
                        onClick = {
                            runCatching { compartilharComprovanteImagem(context, recibo) }
                                .onFailure {
                                    Toast.makeText(context, "Não foi possível criar a imagem do comprovante.", Toast.LENGTH_LONG).show()
                                }
                        },
                        modifier = Modifier.fillMaxWidth().height(52.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Cores.Verde, contentColor = Color(0xFF06110B)),
                    ) {
                        Text("Compartilhar comprovante em imagem", fontWeight = FontWeight.Bold)
                    }
                    TextButton(onClick = { comprovante = null }, modifier = Modifier.fillMaxWidth()) {
                        Text("Fechar", color = Color.White.copy(alpha = 0.75f))
                    }
                }
            }
        }
    }
}

@Composable
private fun LinhaComprovante(
    rotulo: String,
    valor: String,
    valorVerde: Boolean = false,
    iconeCarteira: Boolean = false,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(rotulo, color = Color.White.copy(alpha = 0.58f), fontSize = 12.sp)
        Row(
            modifier = Modifier.weight(1f, fill = false),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (iconeCarteira) Icon(Icons.Filled.AccountBalanceWallet, contentDescription = null, tint = Cores.Turquesa, modifier = Modifier.size(15.dp))
            Text(
                valor,
                color = if (valorVerde) Cores.Verde else Color.White,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                textAlign = TextAlign.End,
            )
        }
    }
}

@Composable
fun TelaPerfil(
    apelido: String,
    username: String,
    email: String,
    saldoCentavos: Long,
    nivel: Int,
    partidas: Int,
    vitorias: Int,
    avatarUrl: String,
    avatarItensEquipados: List<String>,
    avatarComoFotoPerfil: Boolean,
    bio: String,
    inventario: List<String>,
    molduraEquipada: String,
    tituloEquipado: String = "",
    onEscolherMoldura: (String, (String?) -> Unit) -> Unit,
    onEnviarFoto: (Uri, (String?, String?) -> Unit) -> Unit,
    onSalvarPerfil: (String, String, String, Boolean, String, (String?) -> Unit) -> Unit,
    onEquiparItemAvatar: (String, String?, (String?) -> Unit) -> Unit,
    onEquiparTitulo: (String?, (String?) -> Unit) -> Unit = { _, concluir -> concluir(null) },
    onAbrirLoja: () -> Unit,
    onSair: () -> Unit,
    onAbrirConta: () -> Unit = {},
    confirmarAcoesImportantes: Boolean = true,
) {
    var apelidoEditavel by rememberSaveable { mutableStateOf(apelido) }
    var usernameEditavel by rememberSaveable { mutableStateOf(username) }
    var avatarUrlEditavel by rememberSaveable { mutableStateOf(avatarUrl) }
    var avatarComoFotoEditavel by rememberSaveable { mutableStateOf(avatarComoFotoPerfil) }
    var bioEditavel by rememberSaveable { mutableStateOf(bio) }
    var mensagemPerfil by rememberSaveable { mutableStateOf("") }
    var mensagemMoldura by rememberSaveable { mutableStateOf("") }
    var confirmarSaida by rememberSaveable { mutableStateOf(false) }
    var enviandoFoto by remember { mutableStateOf(false) }
    val seletorFoto = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) {
            enviandoFoto = true
            onEnviarFoto(uri) { url, erro ->
                enviandoFoto = false
                if (erro == null && url != null) {
                    avatarUrlEditavel = url
                    mensagemPerfil = "Foto atualizada. Salve o perfil para publicar a alteração."
                } else mensagemPerfil = erro ?: "Não foi possível enviar a foto."
            }
        }
    }
    LaunchedEffect(apelido, username, avatarUrl, bio) {
        apelidoEditavel = apelido
        usernameEditavel = username
        avatarUrlEditavel = avatarUrl
        avatarComoFotoEditavel = avatarComoFotoPerfil
        bioEditavel = bio
    }

    TelaBase("Perfil", "Seu espaço no Zeca.") {
        GlassCard {
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
                AvatarComMoldura(
                    apelidoEditavel.take(1).uppercase(), molduraEquipada, 124.dp,
                    photoUrl = avatarUrlEditavel,
                    avatarItems = avatarItensEquipados,
                    avatarAsProfilePhoto = avatarComoFotoEditavel,
                )
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    Text("SUA IDENTIDADE", color = Cores.Verde, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                    Text(apelidoEditavel, color = Color.White, fontSize = 19.sp, fontWeight = FontWeight.Black, maxLines = 2)
                    Text("@${usernameEditavel}", color = Cores.Turquesa, fontSize = 12.sp)
                    Text(
                        "Moldura · ${catalogoLoja.firstOrNull { it.id == molduraEquipada }?.nome ?: "Padrão"}",
                        color = Color.White.copy(alpha = 0.72f),
                        fontSize = 11.sp,
                        maxLines = 2,
                    )
                    Text(
                        "Título · ${catalogoLoja.firstOrNull { it.id == tituloEquipado }?.nome ?: "Nenhum"}",
                        color = Color.White.copy(alpha = 0.72f),
                        fontSize = 11.sp,
                        maxLines = 2,
                    )
                }
            }
            Button(
                onClick = { seletorFoto.launch("image/*") },
                enabled = !enviandoFoto,
                modifier = Modifier.fillMaxWidth(),
            ) { Text(if (enviandoFoto) "Enviando foto..." else "Alterar foto de perfil") }
            OutlinedTextField(
                value = usernameEditavel,
                onValueChange = { value ->
                    usernameEditavel = value.filter { it in 'a'..'z' || it in 'A'..'Z' || it in '0'..'9' || it == '_' }
                        .lowercase().take(20)
                    mensagemPerfil = ""
                },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Nome de usuário") },
                prefix = { Text("@") },
                supportingText = { Text("3 a 20 caracteres: letras, números e _") },
                singleLine = true,
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = avatarComoFotoEditavel, onCheckedChange = { avatarComoFotoEditavel = it; mensagemPerfil = "" })
                Column {
                    Text("Usar meu avatar como foto de perfil", color = Color.White, fontSize = 12.sp)
                    Text("O avatar aparecerá para outras pessoas no ranking e no chat.", color = Color.White.copy(alpha = 0.58f), fontSize = 10.sp)
                }
            }
            OutlinedTextField(
                value = apelidoEditavel,
                onValueChange = { apelidoEditavel = it.take(24); mensagemPerfil = "" },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Nome de exibição") },
                singleLine = true,
            )
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("SUA BIO", color = Cores.Verde, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                Text(
                    "Uma frase para as pessoas conhecerem você.",
                    color = Color.White.copy(alpha = 0.62f),
                    fontSize = 12.sp,
                )
                OutlinedTextField(
                    value = bioEditavel,
                    onValueChange = { bioEditavel = it.take(160); mensagemPerfil = "" },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Sobre você") },
                    placeholder = { Text("O que você gosta de fazer?") },
                    supportingText = {
                        Text("Visível para outros jogadores · ${bioEditavel.length}/160")
                    },
                    minLines = 3,
                    maxLines = 4,
                )
            }
            Text(email, color = Color.White.copy(alpha = 0.62f), fontSize = 12.sp)
            Text("Nível $nivel · ${partidas % 10}/10 partidas para o próximo", color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.Bold)
            LinearProgressIndicator(
                progress = { (partidas % 10) / 10f },
                modifier = Modifier.fillMaxWidth().height(7.dp).clip(CircleShape),
                color = Cores.Verde,
                trackColor = Color.White.copy(alpha = 0.12f),
            )
            Text("Próximo nível: bônus de ${formatarReais(nivel.toLong() * 5_000L)}", color = Cores.Turquesa, fontSize = 12.sp)
            Button(
                onClick = {
                    onSalvarPerfil(usernameEditavel, apelidoEditavel.trim(), avatarUrlEditavel, avatarComoFotoEditavel, bioEditavel.trim()) { erro ->
                        mensagemPerfil = erro ?: "Perfil atualizado."
                    }
                },
                enabled = Regex("^[a-z0-9_]{3,20}$").matches(usernameEditavel)
                    && apelidoEditavel.trim().length in 2..24
                    && (apelidoEditavel.trim() != apelido || usernameEditavel != username || avatarUrlEditavel != avatarUrl || avatarComoFotoEditavel != avatarComoFotoPerfil || bioEditavel.trim() != bio)
                    && !enviandoFoto,
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Salvar perfil") }
            if (mensagemPerfil.isNotBlank()) Text(mensagemPerfil, color = if (mensagemPerfil.contains("atualizado") || mensagemPerfil.contains("Foto atualizada")) Cores.Verde else Cores.Laranja, fontSize = 12.sp)
        }
        GlassCard {
            Text("Estatísticas", color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold)
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Estatistica("Partidas", partidas.toString())
                Estatistica("Vitórias", vitorias.toString())
                Estatistica("Saldo", formatarReais(saldoCentavos))
            }
        }
        GlassCard {
            Text("Coleção", color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold)
            ItensColecao(
                inventario,
                molduraEquipada = molduraEquipada,
                tituloEquipado = tituloEquipado,
                avatarItensEquipados = avatarItensEquipados,
                onEscolherMoldura = { itemId ->
                    mensagemMoldura = ""
                    onEscolherMoldura(itemId) { erro -> if (erro != null) mensagemMoldura = erro }
                },
                onEquiparItemAvatar = { slot, itemId ->
                    mensagemMoldura = ""
                    onEquiparItemAvatar(slot, itemId) { erro -> if (erro != null) mensagemMoldura = erro }
                },
                onEquiparTitulo = { itemId ->
                    mensagemMoldura = ""
                    onEquiparTitulo(itemId) { erro ->
                        mensagemMoldura = erro ?: if (itemId == null) "Título removido." else "Título equipado."
                    }
                },
            )
            if (mensagemMoldura.isNotBlank()) Text(mensagemMoldura, color = Cores.Laranja, fontSize = 12.sp)
        }
        Button(onClick = onAbrirLoja, modifier = Modifier.fillMaxWidth()) { Text("Personalizar avatar e abrir loja") }
        OutlinedButton(onClick = onAbrirConta, modifier = Modifier.fillMaxWidth()) { Text("Central da conta · amigos e configurações") }
        TextButton(
            onClick = {
                if (confirmarAcoesImportantes) confirmarSaida = true else onSair()
            },
            modifier = Modifier.fillMaxWidth(),
        ) { Text("Sair da conta") }
        if (confirmarSaida) {
            AlertDialog(
                onDismissRequest = { confirmarSaida = false },
                title = { Text("Sair da conta?") },
                text = { Text("Você precisará entrar novamente para acessar suas partidas e configurações.") },
                confirmButton = {
                    TextButton(onClick = {
                        confirmarSaida = false
                        onSair()
                    }) { Text("Sair") }
                },
                dismissButton = {
                    TextButton(onClick = { confirmarSaida = false }) { Text("Cancelar") }
                },
            )
        }
    }
}

@Composable
fun TelaLoja(
    saldoCentavos: Long,
    itensComprados: List<String>,
    apelido: String,
    username: String,
    avatarUrl: String,
    avatarItensEquipados: List<String>,
    avatarComoFotoPerfil: Boolean,
    molduraEquipada: String,
    tituloEquipado: String = "",
    onVoltar: () -> Unit,
    onComprar: (String, (String?) -> Unit) -> Unit,
    onEquiparAvatar: (String, String?, (String?) -> Unit) -> Unit,
    onEquiparMoldura: (String, (String?) -> Unit) -> Unit,
    onEquiparTitulo: (String?, (String?) -> Unit) -> Unit = { _, concluir -> concluir(null) },
) {
    val produtos = catalogoLoja
    var categoria by rememberSaveable { mutableStateOf("Avatar") }
    var mensagem by rememberSaveable { mutableStateOf("") }
    var mensagemErro by rememberSaveable { mutableStateOf(false) }
    var itemComMensagem by rememberSaveable { mutableStateOf("") }
    var itemEmCompra by rememberSaveable { mutableStateOf("") }
    var itemEmUso by rememberSaveable { mutableStateOf("") }
    var mostrarPreviaAvatar by rememberSaveable { mutableStateOf(false) }

    BackHandler(onBack = onVoltar)

    TelaBase("Loja", "Escolha um detalhe para o seu perfil.", onVoltar = onVoltar) {
        GlassCard {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                AvatarComMoldura(
                    apelido.take(1).uppercase(),
                    molduraEquipada,
                    100.dp,
                    photoUrl = "",
                    avatarItems = avatarItensEquipados,
                    avatarAsProfilePhoto = true,
                )
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text("SEU AVATAR", color = Cores.Verde, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                    Text(apelido, color = Color.White, fontSize = 17.sp, fontWeight = FontWeight.Bold)
                    Text("@${username}", color = Color.White.copy(alpha = 0.6f), fontSize = 11.sp)
                    Text("${avatarItensEquipados.size} peças vestidas", color = Cores.Turquesa, fontSize = 11.sp)
                    Text("Moldura · ${catalogoLoja.firstOrNull { it.id == molduraEquipada }?.nome ?: "Padrão"}", color = Color.White.copy(alpha = 0.72f), fontSize = 10.sp, maxLines = 1)
                    Text("Título · ${catalogoLoja.firstOrNull { it.id == tituloEquipado }?.nome ?: "Nenhum"}", color = Color.White.copy(alpha = 0.72f), fontSize = 10.sp, maxLines = 1)
                }
            }
            TextButton(onClick = onVoltar, modifier = Modifier.fillMaxWidth()) {
                Text("Editar avatar e foto no perfil", color = Cores.Turquesa)
            }
            TextButton(onClick = { mostrarPreviaAvatar = true }, modifier = Modifier.fillMaxWidth()) {
                Text("Ver prévia do avatar", color = Cores.Turquesa)
            }
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(Brush.linearGradient(listOf(Cores.Verde.copy(alpha = 0.2f), Color.White.copy(alpha = 0.06f))), RoundedCornerShape(18.dp))
                .border(1.dp, Color.White.copy(alpha = 0.18f), RoundedCornerShape(18.dp))
                .padding(16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column {
                Text("SEU SALDO", color = Color.White.copy(alpha = 0.62f), fontSize = 10.sp, fontWeight = FontWeight.Bold)
                Text(formatarReais(saldoCentavos), color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Black)
            }
            Text("${itensComprados.size} itens", color = Cores.Verde, fontSize = 13.sp, fontWeight = FontWeight.Bold)
        }
        Opcoes(listOf("Todos", "Avatar", "Molduras", "Títulos"), categoria) { categoria = it }
        val produtosVisiveis = produtos.filter { produto ->
            when (categoria) {
                "Avatar" -> produto.avatarSlot.isNotBlank()
                "Molduras" -> produto.id.startsWith("frame_")
                "Títulos" -> produto.id.startsWith("title_")
                else -> true
            }
        }
        Text("${produtosVisiveis.size} itens", color = Color.White.copy(alpha = 0.6f), fontSize = 11.sp)
        produtosVisiveis.forEach { produto ->
            val comprado = produto.id in itensComprados
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(
                        Brush.linearGradient(listOf(produto.cor.copy(alpha = 0.2f), Color.White.copy(alpha = 0.08f), Cores.Cartao.copy(alpha = 0.75f))),
                        RoundedCornerShape(20.dp),
                    )
                    .border(1.dp, Color.White.copy(alpha = 0.2f), RoundedCornerShape(20.dp))
                    .animateContentSize()
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        modifier = Modifier
                            .size(62.dp)
                            .background(produto.cor.copy(alpha = 0.2f), RoundedCornerShape(16.dp))
                            .border(1.dp, produto.cor.copy(alpha = 0.6f), RoundedCornerShape(16.dp)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(produto.simbolo, color = produto.cor, fontSize = 30.sp, fontWeight = FontWeight.Black)
                    }
                    Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(produto.nome, color = Color.White, fontSize = 17.sp, fontWeight = FontWeight.Bold)
                        Text(produto.descricao, color = Color.White.copy(alpha = 0.68f), fontSize = 12.sp)
                    }
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        formatarReais(produto.precoCentavos),
                        modifier = Modifier.weight(1f),
                        color = produto.cor,
                        fontSize = 17.sp,
                        fontWeight = FontWeight.Black,
                        maxLines = 1,
                    )
                    if (produto.avatarSlot.isNotBlank() && comprado) {
                        val vestido = produto.id in avatarItensEquipados
                        TextButton(
                            onClick = {
                                itemComMensagem = produto.id
                                mensagem = ""
                                mensagemErro = false
                                itemEmUso = produto.id
                                onEquiparAvatar(produto.avatarSlot, if (vestido) null else produto.id) { erro ->
                                    itemEmUso = ""
                                    mensagemErro = erro != null
                                    mensagem = erro ?: if (vestido) "Peça removida do avatar." else "Peça vestida no avatar."
                                }
                            },
                            enabled = itemEmUso.isBlank() && itemEmCompra.isBlank(),
                        ) {
                            Text(
                                when {
                                    itemEmUso == produto.id -> "Salvando..."
                                    vestido -> "Vestindo"
                                    else -> "Vestir"
                                },
                                color = if (vestido) Cores.Turquesa else Color.White,
                                fontWeight = FontWeight.Bold,
                            )
                        }
                    }
                    if (produto.id.startsWith("frame_") && comprado) {
                        val molduraEmUso = produto.id == molduraEquipada
                        TextButton(
                            onClick = {
                                itemComMensagem = produto.id
                                mensagem = ""
                                mensagemErro = false
                                itemEmUso = produto.id
                                onEquiparMoldura(if (molduraEmUso) "" else produto.id) { erro ->
                                    itemEmUso = ""
                                    mensagemErro = erro != null
                                    mensagem = erro ?: if (molduraEmUso) "Moldura removida." else "Moldura aplicada ao avatar."
                                }
                            },
                            enabled = itemEmUso.isBlank() && itemEmCompra.isBlank(),
                        ) {
                            Text(
                                when {
                                    itemEmUso == produto.id -> "Salvando..."
                                    molduraEmUso -> "Em uso"
                                    else -> "Usar"
                                },
                                color = if (molduraEmUso) produto.cor else Color.White,
                                fontWeight = FontWeight.Bold,
                            )
                        }
                    }
                    if (produto.id.startsWith("title_") && comprado) {
                        val tituloEmUso = produto.id == tituloEquipado
                        TextButton(
                            onClick = {
                                itemComMensagem = produto.id
                                mensagem = ""
                                mensagemErro = false
                                itemEmUso = produto.id
                                onEquiparTitulo(if (tituloEmUso) null else produto.id) { erro ->
                                    itemEmUso = ""
                                    mensagemErro = erro != null
                                    mensagem = erro ?: if (tituloEmUso) "Título removido." else "Título equipado."
                                }
                            },
                            enabled = itemEmUso.isBlank() && itemEmCompra.isBlank(),
                        ) {
                            Text(
                                when {
                                    itemEmUso == produto.id -> "Salvando..."
                                    tituloEmUso -> "Em uso"
                                    else -> "Usar"
                                },
                                color = if (tituloEmUso) produto.cor else Color.White,
                                fontWeight = FontWeight.Bold,
                            )
                        }
                    }
                    Button(
                        onClick = {
                            itemComMensagem = produto.id
                            if (saldoCentavos < produto.precoCentavos) {
                                mensagemErro = true
                                mensagem = "Faltam ${formatarReais(produto.precoCentavos - saldoCentavos)} para comprar ${produto.nome}."
                            } else {
                                itemEmCompra = produto.id
                                mensagem = ""
                                onComprar(produto.id) { erro ->
                                    itemEmCompra = ""
                                    mensagemErro = erro != null
                                    mensagem = erro ?: "Item adicionado à coleção."
                                }
                            }
                        },
                        enabled = !comprado && itemEmCompra.isBlank(),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = if (comprado || saldoCentavos < produto.precoCentavos) Color.White.copy(alpha = 0.14f) else Color.White,
                            disabledContainerColor = Color.White.copy(alpha = 0.14f),
                        ),
                    ) {
                        val buttonLabel = when {
                            comprado -> "Na coleção"
                            itemEmCompra == produto.id -> "Comprando..."
                            saldoCentavos < produto.precoCentavos -> "Saldo insuficiente"
                            else -> "Desbloquear"
                        }
                        Crossfade(targetState = buttonLabel, label = "store-purchase-${produto.id}") { label ->
                            Text(
                                label,
                                color = if (comprado || saldoCentavos < produto.precoCentavos || label == "Comprando...") Color.White else Color(0xFF111418),
                                fontWeight = FontWeight.Bold,
                                maxLines = 1,
                            )
                        }
                    }
                }
                if (itemComMensagem == produto.id && mensagem.isNotBlank()) {
                    Text(
                        mensagem,
                        color = if (mensagemErro) Cores.Laranja else Cores.Verde,
                        fontSize = 12.sp,
                    )
                }
            }
        }
        TextButton(onClick = onVoltar, modifier = Modifier.fillMaxWidth()) { Text("Voltar ao perfil") }
    }

    if (mostrarPreviaAvatar) {
        Dialog(
            onDismissRequest = { mostrarPreviaAvatar = false },
            properties = DialogProperties(usePlatformDefaultWidth = false),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth(0.88f)
                    .clip(RoundedCornerShape(24.dp))
                    .background(Brush.verticalGradient(listOf(Color(0xFF222A2E), Cores.Cartao, Cores.Fundo)))
                    .border(1.dp, Color.White.copy(alpha = 0.17f), RoundedCornerShape(24.dp))
                    .padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Text("Prévia do avatar", color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                AvatarComMoldura(
                    apelido.take(1).uppercase(),
                    molduraEquipada,
                    190.dp,
                    avatarItems = avatarItensEquipados,
                    avatarAsProfilePhoto = true,
                )
                Text(
                    "${avatarItensEquipados.size} peças vestidas",
                    color = Cores.Turquesa,
                    fontSize = 13.sp,
                )
                Text(
                    "${catalogoLoja.firstOrNull { it.id == molduraEquipada }?.nome ?: "Moldura padrão"} · ${catalogoLoja.firstOrNull { it.id == tituloEquipado }?.nome ?: "Sem título"}",
                    color = Color.White.copy(alpha = 0.72f),
                    fontSize = 12.sp,
                    textAlign = TextAlign.Center,
                )
                TextButton(onClick = { mostrarPreviaAvatar = false }) {
                    Text("Fechar", color = Cores.Turquesa)
                }
            }
        }
    }
}

@Composable
private fun TelaBase(
    titulo: String,
    subtitulo: String,
    onVoltar: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(Color(0xFF151A1D), Cores.Fundo, Color(0xFF090D10)))),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(start = 20.dp, top = 30.dp, end = 20.dp, bottom = 118.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            if (onVoltar != null) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = onVoltar) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Voltar", tint = Color.White)
                    }
                    Text(titulo, color = Color.White, fontSize = 29.sp, fontWeight = FontWeight.Black)
                }
            } else {
                Text(titulo, color = Color.White, fontSize = 29.sp, fontWeight = FontWeight.Black)
            }
            Text(subtitulo, color = Color.White.copy(alpha = 0.62f), fontSize = 13.sp)
            content()
        }
    }
}

@Composable
private fun GlassCard(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(
                Brush.verticalGradient(listOf(Color.White.copy(alpha = 0.14f), Color.White.copy(alpha = 0.055f))),
                RoundedCornerShape(22.dp),
            )
            .border(1.dp, Brush.linearGradient(listOf(Color.White.copy(alpha = 0.4f), Color.White.copy(alpha = 0.1f))), RoundedCornerShape(22.dp))
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        content = content,
    )
}

@Composable
private fun Opcoes(opcoes: List<String>, selecionada: String, onSelecionar: (String) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().background(Color.White.copy(alpha = 0.07f), RoundedCornerShape(14.dp)).padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        opcoes.forEach { opcao ->
            Box(
                modifier = Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(11.dp))
                    .background(if (opcao == selecionada) Color.White.copy(alpha = 0.9f) else Color.Transparent)
                    .clickable { onSelecionar(opcao) }
                    .padding(horizontal = 8.dp, vertical = 11.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(opcao, color = if (opcao == selecionada) Color(0xFF111418) else Color.White.copy(alpha = 0.8f), fontSize = 13.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun Estatistica(rotulo: String, valor: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(valor, color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.Bold)
        Text(rotulo, color = Color.White.copy(alpha = 0.58f), fontSize = 11.sp)
    }
}

internal data class Produto(
    val id: String,
    val nome: String,
    val descricao: String,
    val precoCentavos: Long,
    val cor: Color,
    val simbolo: String,
    val avatarSlot: String = "",
)

internal val catalogoLoja = listOf(
    Produto("frame_aurora", "Moldura Aurora", "Um brilho suave em volta do seu avatar.", 1_299L, Cores.Turquesa, "✦"),
    Produto("title_lucky", "Sorte Grande", "Um título para mostrar no seu perfil.", 799L, Cores.Laranja, "★"),
    Produto("frame_neon", "Moldura Neon", "Uma borda vibrante para o seu avatar.", 1_999L, Color(0xFFFF8290), "◈"),
    Produto("frame_gold", "Moldura Dourada", "Um contorno dourado de alto nível.", 2_499L, Color(0xFFFFD166), "❖"),
    Produto("title_highroller", "Alto Rolo", "Um título para quem aposta grande.", 1_499L, Color(0xFFB388FF), "♦"),
    Produto("frame_emerald", "Moldura Esmeralda", "Um verde profundo em volta do avatar.", 1_699L, Color(0xFF3DDC97), "✧"),
    Produto("title_champion", "Campeão", "O título de quem domina o ranking.", 2_999L, Color(0xFF64B5F6), "✪"),
    Produto("frame_royal", "Moldura Real", "Uma moldura digna de realeza.", 3_999L, Color(0xFFE040FB), "♛"),
    Produto("title_jucineia", "Jucineia", "Um título exclusivo para o seu perfil.", 1_250_000L, Color(0xFFFF7043), "♠"),
    Produto("title_donizete", "Donizete", "Um título raro para mostrar no perfil.", 1_000_000L, Color(0xFF26C6DA), "♣"),
    Produto("title_erasmo", "Erasmo", "Um título de peso para poucos jogadores.", 1_500_000L, Color(0xFFFFCA28), "♥"),
    Produto("title_milena", "Milena", "Um título de destaque para o seu perfil.", 1_100_000L, Color(0xFFEC407A), "☾"),
    Produto("avatar_hair_wave", "Cabelo Ondulado", "Um corte leve com ondas marcantes.", 999L, Color(0xFF805B42), "〰", "hair"),
    Produto("avatar_hair_curls", "Cachos", "Volume e personalidade para o visual.", 1_299L, Color(0xFF4E352F), "✿", "hair"),
    Produto("avatar_hair_silver", "Cor Prateada", "Um brilho prateado no cabelo.", 899L, Color(0xFFC8D3DC), "✧", "hairColor"),
    Produto("avatar_skin_sun", "Tom Solar", "Um tom de pele quente.", 699L, Color(0xFFD99B70), "●", "skin"),
    Produto("avatar_skin_cocoa", "Tom Cacau", "Um tom de pele cacau.", 699L, Color(0xFF8D5B43), "●", "skin"),
    Produto("avatar_top_hoodie", "Moletom Neon", "Moletom com detalhes turquesa.", 1_299L, Cores.Turquesa, "▰", "outfit"),
    Produto("avatar_top_jacket", "Jaqueta Aurora", "Jaqueta em tons de pôr do sol.", 1_499L, Color(0xFFFF7A59), "◈", "outfit"),
    Produto("avatar_glasses_round", "Óculos Redondos", "Armação divertida para completar o rosto.", 799L, Color(0xFF6FE7E1), "◎", "accessory"),
    Produto("avatar_crown_neon", "Coroa Neon", "Uma coroa luminosa para chegar chegando.", 1_999L, Color(0xFFFFD166), "♛", "accessory"),
    Produto("avatar_hair_afro", "Afro Lunar", "Um visual volumoso com cachos definidos.", 1_599L, Color(0xFF7B5138), "✿", "hair"),
    Produto("avatar_hair_blue", "Tinta Azul", "Cabelo azul intenso para mudar o visual.", 1_099L, Color(0xFF4C9DFF), "✦", "hairColor"),
    Produto("avatar_skin_olive", "Tom Oliva", "Um tom de pele oliva para personalizar o avatar.", 799L, Color(0xFFB8895D), "●", "skin"),
    Produto("avatar_top_sport", "Jaqueta Esportiva", "Uma jaqueta esportiva com faixas claras.", 1_599L, Color(0xFF4387D7), "▰", "outfit"),
    Produto("avatar_top_space", "Traje Estelar", "Uma roupa noturna com detalhes de estrelas.", 1_899L, Color(0xFF6652A5), "✧", "outfit"),
    Produto("avatar_glasses_square", "Óculos Quadrados", "Armação geométrica em turquesa.", 899L, Color(0xFF6FE7E1), "▣", "accessory"),
    Produto("avatar_earrings_star", "Brincos Estrela", "Pequenas estrelas douradas nas orelhas.", 799L, Color(0xFFFFD166), "✦", "earrings"),
    Produto("avatar_cap_mint", "Boné Menta", "Um boné verde-menta para completar o conjunto.", 1_099L, Color(0xFF56D6B0), "◒", "headwear"),
)

internal fun coresMoldura(id: String): List<Color>? = when (id) {
    "frame_aurora" -> listOf(Cores.Turquesa, Color(0xFF7C4DFF), Color(0xFF3DDC97), Cores.Turquesa)
    "frame_neon" -> listOf(Color(0xFFFF8290), Color(0xFFFF2D95), Color(0xFFFF8290))
    "frame_gold" -> listOf(Color(0xFFFFD166), Color(0xFFFFF1B8), Color(0xFFFFB300), Color(0xFFFFD166))
    "frame_emerald" -> listOf(Color(0xFF3DDC97), Color(0xFF0B8F5A), Color(0xFF3DDC97))
    "frame_royal" -> listOf(Color(0xFFE040FB), Color(0xFF7C4DFF), Color(0xFFFFD166), Color(0xFFE040FB))
    else -> null
}

@Composable
internal fun AvatarComMoldura(
    inicial: String,
    moldura: String,
    tamanho: Dp,
    modifier: Modifier = Modifier,
    photoUrl: String = "",
    avatarItems: List<String> = emptyList(),
    avatarAsProfilePhoto: Boolean = false,
) {
    val cores = coresMoldura(moldura)
    Box(
        modifier = modifier
            .size(tamanho + 16.dp)
            .then(if (cores != null) Modifier.border(4.dp, Brush.sweepGradient(cores), CircleShape) else Modifier),
        contentAlignment = Alignment.Center,
    ) {
        Box(Modifier.size(tamanho).clip(CircleShape).border(1.dp, Color.White.copy(alpha = 0.4f), CircleShape)) {
            if (avatarAsProfilePhoto) {
                AvatarPersonagem(inicial, avatarItems, tamanho)
            } else if (photoUrl.isNotBlank()) {
                AsyncImage(
                    model = photoUrl,
                    contentDescription = "Foto de perfil",
                    modifier = Modifier.fillMaxSize(),
                    contentScale = ContentScale.Crop,
                )
            } else {
                Text(inicial, color = Cores.Verde, fontSize = (tamanho.value * 0.42f).sp, fontWeight = FontWeight.Black)
            }
        }
    }
}

@Composable
internal fun AvatarPersonagem(inicial: String, itens: List<String>, tamanho: Dp, modifier: Modifier = Modifier) {
    val pele = when {
        "avatar_skin_olive" in itens -> Color(0xFFB8895D)
        "avatar_skin_cocoa" in itens -> Color(0xFF8D5B43)
        "avatar_skin_sun" in itens -> Color(0xFFD99B70)
        else -> Color(0xFFE9B18A)
    }
    val cabelo = when {
        "avatar_hair_blue" in itens -> Color(0xFF4C9DFF)
        "avatar_hair_silver" in itens -> Color(0xFFC8D3DC)
        "avatar_hair_curls" in itens -> Color(0xFF4E352F)
        "avatar_hair_wave" in itens -> Color(0xFF805B42)
        "avatar_hair_afro" in itens -> Color(0xFF7B5138)
        else -> Color(0xFF352923)
    }
    val roupa = when {
        "avatar_top_space" in itens -> Color(0xFF42366E)
        "avatar_top_sport" in itens -> Color(0xFF3476C2)
        "avatar_top_jacket" in itens -> Color(0xFFFF7A59)
        "avatar_top_hoodie" in itens -> Color(0xFF21B9AC)
        else -> Color(0xFF317B70)
    }
    Box(
        modifier = modifier.size(tamanho).clip(CircleShape)
            .background(Brush.verticalGradient(listOf(Color(0xFF355F65), Color(0xFF172B32)))),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth(0.76f).height(tamanho * 0.43f)
                .clip(RoundedCornerShape(topStart = tamanho * 0.3f, topEnd = tamanho * 0.3f))
                .background(roupa),
        )
        Box(
            Modifier.align(Alignment.TopCenter).padding(top = tamanho * 0.19f)
                .size(tamanho * 0.54f, tamanho * 0.60f)
                .clip(RoundedCornerShape(tamanho * 0.27f))
                .background(pele),
        )
        Box(
            Modifier.align(Alignment.TopCenter).offset(y = tamanho * 0.20f)
                .size(tamanho * 0.58f, tamanho * if ("avatar_hair_curls" in itens) 0.25f else 0.19f)
                .clip(RoundedCornerShape(topStart = tamanho * 0.32f, topEnd = tamanho * 0.32f, bottomEnd = tamanho * 0.1f))
                .background(cabelo),
        )
        if ("avatar_hair_afro" in itens) {
            Row(
                modifier = Modifier.align(Alignment.TopCenter).offset(y = tamanho * 0.12f),
                horizontalArrangement = Arrangement.spacedBy(tamanho * 0.005f),
            ) {
                repeat(5) { Box(Modifier.size(tamanho * 0.14f).clip(CircleShape).background(cabelo)) }
            }
        }
        if ("avatar_cap_mint" in itens) {
            Box(
                Modifier.align(Alignment.TopCenter).offset(y = tamanho * 0.075f)
                    .size(tamanho * 0.42f, tamanho * 0.16f)
                    .clip(RoundedCornerShape(topStart = tamanho * 0.18f, topEnd = tamanho * 0.18f))
                    .background(Color(0xFF56D6B0)),
            )
            Box(
                Modifier.align(Alignment.TopCenter).offset(x = tamanho * 0.08f, y = tamanho * 0.22f)
                    .size(tamanho * 0.34f, tamanho * 0.055f)
                    .clip(CircleShape)
                    .background(Color(0xFF3AAE8D)),
            )
        }
        Row(
            modifier = Modifier.align(Alignment.Center).offset(y = tamanho * 0.035f),
            horizontalArrangement = Arrangement.spacedBy(tamanho * 0.12f),
        ) {
            repeat(2) {
                Box(Modifier.size(tamanho * 0.055f).clip(CircleShape).background(Color(0xFF302824)))
            }
        }
        Box(
            Modifier.align(Alignment.Center).offset(y = tamanho * 0.17f)
                .size(tamanho * 0.13f, tamanho * 0.035f)
                .clip(CircleShape)
                .background(Color(0xFFAC5D59)),
        )
        if ("avatar_top_sport" in itens) {
            Box(
                Modifier.align(Alignment.BottomCenter).offset(y = -tamanho * 0.15f)
                    .size(tamanho * 0.045f, tamanho * 0.27f)
                    .background(Color(0xFFEAF4FF)),
            )
        }
        if ("avatar_top_space" in itens) {
            Text("✦", modifier = Modifier.align(Alignment.BottomCenter).offset(x = -tamanho * 0.13f, y = -tamanho * 0.18f), color = Color(0xFFFFD166), fontSize = (tamanho.value * 0.13f).sp)
            Text("✦", modifier = Modifier.align(Alignment.BottomCenter).offset(x = tamanho * 0.13f, y = -tamanho * 0.28f), color = Color(0xFFFFD166), fontSize = (tamanho.value * 0.10f).sp)
        }
        if ("avatar_earrings_star" in itens) {
            Text("✦", modifier = Modifier.align(Alignment.CenterStart).offset(x = tamanho * 0.16f, y = tamanho * 0.07f), color = Color(0xFFFFD166), fontSize = (tamanho.value * 0.14f).sp)
            Text("✦", modifier = Modifier.align(Alignment.CenterEnd).offset(x = -tamanho * 0.16f, y = tamanho * 0.07f), color = Color(0xFFFFD166), fontSize = (tamanho.value * 0.14f).sp)
        }
        if ("avatar_glasses_square" in itens) {
            Row(
                modifier = Modifier.align(Alignment.Center).offset(y = tamanho * 0.045f),
                horizontalArrangement = Arrangement.spacedBy(tamanho * 0.035f),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                repeat(2) { Box(Modifier.size(tamanho * 0.18f).border(1.5.dp, Cores.Turquesa, RoundedCornerShape(4.dp))) }
            }
        } else if ("avatar_glasses_round" in itens) {
            Row(
                modifier = Modifier.align(Alignment.Center).offset(y = tamanho * 0.045f),
                horizontalArrangement = Arrangement.spacedBy(tamanho * 0.035f),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                repeat(2) {
                    Box(Modifier.size(tamanho * 0.18f).border(1.5.dp, Cores.Turquesa, CircleShape))
                }
            }
        }
        if ("avatar_crown_neon" in itens) {
            Text("♛", modifier = Modifier.align(Alignment.TopCenter).offset(y = tamanho * 0.015f), color = Color(0xFFFFD166), fontSize = (tamanho.value * 0.28f).sp)
        }
    }
}

@Composable
internal fun ItensColecao(
    ids: List<String>,
    molduraEquipada: String = "",
    tituloEquipado: String = "",
    onEscolherMoldura: ((String) -> Unit)? = null,
    avatarItensEquipados: List<String> = emptyList(),
    onEquiparItemAvatar: ((String, String?) -> Unit)? = null,
    onEquiparTitulo: ((String?) -> Unit)? = null,
) {
    val itens = ids.mapNotNull { id -> catalogoLoja.firstOrNull { it.id == id } }
    var categoriasAbertas by rememberSaveable { mutableStateOf(listOf("Avatar")) }
    if (itens.isEmpty()) {
        Text("Nenhum item na coleção ainda.", color = Color.White.copy(alpha = 0.65f), fontSize = 13.sp)
    } else {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            val grupos = listOf(
                "Avatar" to itens.filter { it.avatarSlot.isNotBlank() },
                "Molduras" to itens.filter { it.id.startsWith("frame_") },
                "Títulos" to itens.filter { it.id.startsWith("title_") },
            ).filter { it.second.isNotEmpty() }
            grupos.forEach { (categoria, itensCategoria) ->
                val expandida = categoria in categoriasAbertas
                Row(
                    modifier = Modifier.fillMaxWidth().clickable {
                        categoriasAbertas = if (expandida) categoriasAbertas - categoria else categoriasAbertas + categoria
                    }.padding(vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(categoria, modifier = Modifier.weight(1f), color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                    Text("${itensCategoria.size}", color = Color.White.copy(alpha = 0.58f), fontSize = 12.sp)
                    Icon(
                        if (expandida) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore,
                        contentDescription = if (expandida) "Recolher $categoria" else "Expandir $categoria",
                        tint = Cores.Turquesa,
                    )
                }
                if (expandida) itensCategoria.forEach { item ->
                val ehMoldura = item.id.startsWith("frame_")
                val ehItemAvatar = item.avatarSlot.isNotBlank()
                val emUso = ehMoldura && item.id == molduraEquipada
                val tituloEmUso = item.id.startsWith("title_") && item.id == tituloEquipado
                val avatarEmUso = ehItemAvatar && item.id in avatarItensEquipados
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(item.cor.copy(alpha = 0.14f), RoundedCornerShape(14.dp))
                        .border(1.dp, item.cor.copy(alpha = 0.5f), RoundedCornerShape(14.dp))
                        .padding(horizontal = 14.dp, vertical = 10.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(item.simbolo, color = item.cor, fontSize = 20.sp, fontWeight = FontWeight.Black)
                    Text(item.nome, modifier = Modifier.weight(1f), color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                    if (ehMoldura) {
                        if (onEscolherMoldura != null) {
                            Box(
                                modifier = Modifier
                                    .clip(RoundedCornerShape(10.dp))
                                    .background(if (emUso) Color.White.copy(alpha = 0.16f) else Color.White)
                                    .clickable { onEscolherMoldura(if (emUso) "" else item.id) }
                                    .padding(horizontal = 12.dp, vertical = 7.dp),
                            ) {
                                Text(
                                    if (emUso) "Em uso" else "Usar",
                                    color = if (emUso) Color.White else Color(0xFF111418),
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold,
                                )
                            }
                        } else if (emUso) {
                            Text("Em uso", color = item.cor, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                    if (ehItemAvatar && onEquiparItemAvatar != null) {
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(10.dp))
                                .background(if (avatarEmUso) Color.White.copy(alpha = 0.16f) else Color.White)
                                .clickable { onEquiparItemAvatar(item.avatarSlot, if (avatarEmUso) null else item.id) }
                                .padding(horizontal = 12.dp, vertical = 7.dp),
                        ) {
                            Text(
                                if (avatarEmUso) "Vestindo" else "Vestir",
                                color = if (avatarEmUso) Color.White else Color(0xFF111418),
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold,
                            )
                        }
                    } else if (avatarEmUso) {
                        Text("Vestindo", color = item.cor, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                    }
                    if (item.id.startsWith("title_") && onEquiparTitulo != null) {
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(10.dp))
                                .background(if (tituloEmUso) Color.White.copy(alpha = 0.16f) else Color.White)
                                .clickable { onEquiparTitulo(if (tituloEmUso) null else item.id) }
                                .padding(horizontal = 12.dp, vertical = 7.dp),
                        ) {
                            Text(
                                if (tituloEmUso) "Em uso" else "Usar",
                                color = if (tituloEmUso) Color.White else Color(0xFF111418),
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold,
                            )
                        }
                    } else if (tituloEmUso) {
                        Text("Em uso", color = item.cor, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                    }
                }
                }
            }
        }
    }
}

internal fun parseValorCentavos(texto: String): Long? {
    val entrada = texto.trim().replace("R$", "").replace(" ", "")
    val normalizada = if (entrada.contains(',')) entrada.replace(".", "").replace(',', '.') else entrada
    val decimal = normalizada.toBigDecimalOrNull() ?: return null
    if (decimal <= BigDecimal.ZERO) return null
    return runCatching {
        decimal.multiply(BigDecimal(100)).setScale(0, RoundingMode.HALF_UP).longValueExact()
    }.getOrNull()
}
