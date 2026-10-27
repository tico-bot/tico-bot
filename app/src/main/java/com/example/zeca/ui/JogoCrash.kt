package com.example.zeca.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.zeca.SessaoCrash
import com.example.zeca.ui.theme.Cores
import kotlinx.coroutines.launch
import kotlin.math.exp
import kotlin.math.ln
import kotlin.math.max

private fun corMultiplicador(bps: Int): Color = when {
    bps >= 1000 -> Color(0xFFFF6BD6)
    bps >= 500 -> Color(0xFFFF9F43)
    bps >= 200 -> Color(0xFFFFD86B)
    else -> Cores.Verde
}

@Composable
fun CrashJogo(
    apostaValida: Boolean,
    carregando: Boolean,
    sessao: SessaoCrash?,
    multiplicadorBps: Int,
    fim: String?,
    lucroCentavos: Long,
    mensagem: String,
    rodada: Int,
    onIniciar: () -> Unit,
    onSacar: () -> Unit,
) {
    val ativo = sessao != null
    val caiu = fim == "caiu"
    val cor = if (caiu) Color(0xFFFF4D6A) else corMultiplicador(multiplicadorBps)
    val vibrar = rememberVibrar()
    val tremor = remember { Animatable(0f) }
    val flash = remember { Animatable(0f) }
    var disparoFesta by remember { mutableStateOf(0) }
    var disparoBoom by remember { mutableStateOf(0) }
    var vitoria by remember { mutableStateOf(false) }

    LaunchedEffect(fim, rodada) {
        when (fim) {
            "caiu" -> {
                vitoria = false
                vibrar(true)
                disparoBoom += 1
                launch {
                    flash.snapTo(0.5f)
                    flash.animateTo(0f, tween(800))
                }
                repeat(8) { i -> tremor.animateTo(if (i % 2 == 0) 14f else -14f, tween(45)) }
                tremor.animateTo(0f, tween(80))
            }
            "retirou" -> {
                vitoria = true
                disparoFesta += 1
                vibrar(true)
            }
            else -> vitoria = false
        }
    }

    val pulso by rememberInfiniteTransition(label = "crash-pulso").animateFloat(
        initialValue = 1f,
        targetValue = 1.05f,
        animationSpec = infiniteRepeatable(tween(520), RepeatMode.Reverse),
        label = "escala",
    )

    Text("Retire antes que o multiplicador pare.", color = Color.White.copy(alpha = 0.65f), fontSize = 12.sp)
    Box(
        Modifier
            .fillMaxWidth()
            .graphicsLayer { translationX = tremor.value },
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(Modifier.fillMaxWidth()) {
                GraficoCrash(multiplicadorBps, caiu, cor)
                Text(
                    text = if (caiu) "💥 CRASH" else formatarMultiplicador(multiplicadorBps),
                    modifier = Modifier
                        .align(Alignment.Center)
                        .graphicsLayer {
                            val escala = if (ativo) pulso else 1f
                            scaleX = escala
                            scaleY = escala
                        },
                    color = if (ativo || caiu) cor else Color.White,
                    fontSize = 46.sp,
                    fontWeight = FontWeight.Black,
                )
            }
            if (sessao != null) {
                val potencial = sessao.apostaCentavos * multiplicadorBps / 100
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("Aposta ${formatarReais(sessao.apostaCentavos)}", color = Color.White.copy(alpha = 0.72f), fontSize = 13.sp)
                    Text("Ganho atual ${formatarReais(potencial)}", color = cor, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                }
                BotaoJogo(
                    texto = if (carregando) "Parando..." else "Retirar · ${formatarReais(potencial)}",
                    onClick = onSacar,
                    enabled = !carregando && multiplicadorBps > 100,
                    cor = cor,
                    modifier = Modifier.fillMaxWidth().height(56.dp),
                )
            } else {
                BannerPremio(lucroCentavos, rodada, vitoria)
                BotaoJogo(
                    texto = if (carregando) "Iniciando..." else "Iniciar Crash",
                    onClick = onIniciar,
                    enabled = apostaValida && !carregando,
                    modifier = Modifier.fillMaxWidth().height(56.dp),
                )
            }
        }
        Box(
            Modifier
                .matchParentSize()
                .graphicsLayer { alpha = flash.value }
                .background(Color(0xFFFF4D6A)),
        )
        ExplosaoMoedas(disparoBoom, Modifier.matchParentSize(), CORES_EXPLOSAO)
        ExplosaoMoedas(disparoFesta, Modifier.matchParentSize())
    }
    StatusText(mensagem)
}

@Composable
private fun GraficoCrash(multiplicadorBps: Int, caiu: Boolean, cor: Color) {
    Canvas(
        modifier = Modifier
            .fillMaxWidth()
            .height(190.dp)
            .clip(RoundedCornerShape(18.dp))
            .background(Brush.verticalGradient(listOf(Color(0xFF10181D), Color(0xFF0A0F12))))
            .padding(12.dp),
    ) {
        val largura = size.width
        val altura = size.height
        val multAtual = (multiplicadorBps / 100f).coerceAtLeast(1f)
        val decorridoMs = 5000f * ln(multAtual)
        val xMax = max(8000f, decorridoMs * 1.15f)
        val yMax = max(2f, multAtual * 1.2f)

        repeat(4) { i ->
            val y = altura * i / 4f
            drawLine(Color.White.copy(alpha = 0.07f), Offset(0f, y), Offset(largura, y), strokeWidth = 1.dp.toPx())
        }

        val passos = 60
        val caminho = Path()
        val area = Path()
        for (i in 0..passos) {
            val t = decorridoMs * i / passos
            val m = exp(t / 5000f)
            val x = largura * (t / xMax)
            val y = altura * (1f - (m - 1f) / (yMax - 1f))
            if (i == 0) {
                caminho.moveTo(x, y)
                area.moveTo(x, altura)
                area.lineTo(x, y)
            } else {
                caminho.lineTo(x, y)
                area.lineTo(x, y)
            }
        }
        val xFim = largura * (decorridoMs / xMax)
        val yFim = altura * (1f - (multAtual - 1f) / (yMax - 1f))
        area.lineTo(xFim, altura)
        area.close()

        drawPath(area, Brush.verticalGradient(listOf(cor.copy(alpha = 0.35f), Color.Transparent)))
        drawPath(caminho, cor, style = Stroke(width = 3.5f.dp.toPx(), cap = StrokeCap.Round))

        if (decorridoMs > 0f && !caiu) {
            val ponta = Offset(xFim, yFim)
            drawCircle(cor.copy(alpha = 0.18f), radius = 16.dp.toPx(), center = ponta)
            drawCircle(cor.copy(alpha = 0.40f), radius = 9.dp.toPx(), center = ponta)
            drawCircle(Color.White, radius = 4.dp.toPx(), center = ponta)
        }
    }
}