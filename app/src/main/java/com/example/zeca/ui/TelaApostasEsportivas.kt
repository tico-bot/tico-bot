package com.example.zeca.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.zeca.ApostaEsportiva
import com.example.zeca.OpcaoApostaEsportiva
import com.example.zeca.PernaApostaEsportiva
import com.example.zeca.PartidaEsportiva
import com.example.zeca.ui.theme.Cores
import java.math.BigDecimal
import java.math.BigInteger
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID

@Composable
fun TelaApostasEsportivas(
    saldoCentavos: Long,
    onCarregarPartidas: ((List<PartidaEsportiva>, Exception?) -> Unit) -> Unit,
    onCarregarApostas: ((List<ApostaEsportiva>, Exception?) -> Unit) -> Unit,
    onApostar: (List<PernaApostaEsportiva>, Long, String, (Exception?) -> Unit) -> Unit,
    onLiquidar: ((Int?, Exception?) -> Unit) -> Unit,
) {
    var partidas by remember { mutableStateOf<List<PartidaEsportiva>>(emptyList()) }
    var apostas by remember { mutableStateOf<List<ApostaEsportiva>>(emptyList()) }
    var valorAposta by rememberSaveable { mutableStateOf("10,00") }
    var carregando by remember { mutableStateOf(false) }
    var erro by remember { mutableStateOf("") }
    var aviso by remember { mutableStateOf("") }
    var selecoes by remember { mutableStateOf<Map<Int, OpcaoApostaEsportiva>>(emptyMap()) }

    val pernasSelecionadas = partidas.mapNotNull { match ->
        val option = selecoes[match.fixtureId] ?: return@mapNotNull null
        PernaApostaEsportiva(
            fixtureId = match.fixtureId,
            campeonato = match.campeonato,
            mandante = match.mandante,
            visitante = match.visitante,
            kickoffMs = match.kickoffMs,
            mercadoId = option.mercadoId,
            mercadoNome = option.mercadoNome,
            selecaoId = option.selecaoId,
            selecaoNome = option.selecaoNome,
            linha = option.linha,
            oddBps = option.oddBps,
        )
    }
    val oddMultiplaBps = calcularOddMultiplaBps(pernasSelecionadas)
    val valorApostaCentavos = parseValorAposta(valorAposta)

    fun carregarDados() {
        carregando = true
        onCarregarPartidas { matches, error ->
            partidas = matches
            erro = error?.localizedMessage.orEmpty()
            onCarregarApostas { bets, betsError ->
                apostas = bets
                if (betsError != null) erro = betsError.localizedMessage.orEmpty()
                carregando = false
            }
        }
    }

    LaunchedEffect(Unit) { carregarDados() }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Column {
                Text("Futebol · odds estimadas", color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                Text("Modelo estatístico · créditos virtuais", color = Color.White.copy(alpha = 0.58f), fontSize = 11.sp)
            }
            TextButton(onClick = {
                carregando = true
                onLiquidar { settled, error ->
                    aviso = if (error == null) {
                        if ((settled ?: 0) > 0) "${settled} aposta(s) liquidada(s)." else "Nenhuma partida terminou ainda."
                    } else ""
                    if (error != null) erro = error.localizedMessage.orEmpty()
                    carregarDados()
                }
            }, enabled = !carregando) { Text("Atualizar placares") }
        }
        Text("Saldo disponível · ${formatarSaldoEsportivo(saldoCentavos)}", color = Cores.Verde, fontWeight = FontWeight.Bold, fontSize = 12.sp)
        OutlinedTextField(
            value = valorAposta,
            onValueChange = { valorAposta = it.filter { char -> char.isDigit() || char == ',' || char == '.' }.take(12) },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Valor da aposta") },
            prefix = { Text("R$ ") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
        )
        if (valorApostaCentavos == null) {
            Text("Informe uma aposta de pelo menos R$ 1,00.", color = Color(0xFFFFB7A7), fontSize = 10.sp)
        } else if (valorApostaCentavos > 1_000_000L) {
            Text("O limite por bilhete é R$ 10.000,00.", color = Color(0xFFFFB7A7), fontSize = 10.sp)
        } else if (valorApostaCentavos > saldoCentavos) {
            Text("Saldo insuficiente para este bilhete.", color = Color(0xFFFFB7A7), fontSize = 10.sp)
        }
        if (aviso.isNotBlank()) Text(aviso, color = Cores.Verde, fontSize = 11.sp)
        if (erro.isNotBlank()) {
            Text(
                erro,
                modifier = Modifier.fillMaxWidth().background(Color(0xFF34272A), RoundedCornerShape(8.dp)).padding(10.dp),
                color = Color(0xFFFFB7A7),
                fontSize = 11.sp,
            )
        }

        Text("Partidas de hoje", color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.Bold)
        if (partidas.isEmpty() && !carregando && erro.isBlank()) {
            Text("Não há partidas futuras com cotações disponíveis hoje.", color = Color.White.copy(alpha = 0.6f), fontSize = 12.sp)
        }
        partidas.forEach { match ->
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color.White.copy(alpha = 0.055f), RoundedCornerShape(10.dp))
                    .border(1.dp, Color.White.copy(alpha = 0.12f), RoundedCornerShape(10.dp))
                    .padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(9.dp),
            ) {
                Text(match.campeonato, color = Cores.Turquesa, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                Text(
                    "${match.mandante}  ×  ${match.visitante}",
                    modifier = Modifier.fillMaxWidth(),
                    color = Color.White,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center,
                )
                Text(formatarHorarioEsportivo(match.kickoffMs), modifier = Modifier.fillMaxWidth(), color = Color.White.copy(alpha = 0.52f), fontSize = 10.sp, textAlign = TextAlign.Center)
                match.mercados.groupBy { it.mercadoNome }.forEach { (marketName, options) ->
                    val bookmaker = options.firstOrNull()?.bookmaker.orEmpty()
                    Text(
                        if (bookmaker.isBlank()) marketName else "$marketName · $bookmaker",
                        color = Color.White.copy(alpha = 0.68f),
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                    )
                    options.chunked(3).forEach { rowOptions ->
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            rowOptions.forEach { option ->
                                val selected = selecoes[match.fixtureId] == option
                                Button(
                                    onClick = {
                                        if (selected) {
                                            selecoes = selecoes - match.fixtureId
                                            erro = ""
                                        } else if (selecoes.size >= 10) {
                                            erro = "A múltipla aceita no máximo 10 partidas diferentes."
                                        } else {
                                            selecoes = selecoes + (match.fixtureId to option)
                                            erro = ""
                                        }
                                    },
                                    enabled = !carregando,
                                    modifier = Modifier.weight(1f),
                                    colors = ButtonDefaults.buttonColors(
                                        containerColor = if (selected) Cores.Turquesa else Color.White.copy(alpha = 0.12f),
                                    ),
                                    shape = RoundedCornerShape(7.dp),
                                ) {
                                    Column(horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally) {
                                        Text("${(option.oddBps / 10_000.0).format(2)}x", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                                        Text(option.selecaoNome, color = Color.White, fontSize = 9.sp, maxLines = 2, textAlign = TextAlign.Center)
                                    }
                                }
                            }
                            repeat(3 - rowOptions.size) { Spacer(Modifier.weight(1f)) }
                        }
                    }
                }
            }
        }

        if (pernasSelecionadas.isNotEmpty()) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color(0xFF11181B), RoundedCornerShape(9.dp))
                    .border(1.dp, Cores.Turquesa.copy(alpha = 0.35f), RoundedCornerShape(9.dp))
                    .padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(7.dp),
            ) {
                Text("Bilhete · ${pernasSelecionadas.size}/10 seleções", color = Cores.Turquesa, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                pernasSelecionadas.forEach { leg ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(
                            "${leg.mandante} x ${leg.visitante} · ${leg.selecaoNome}",
                            modifier = Modifier.weight(1f),
                            color = Color.White.copy(alpha = 0.82f),
                            fontSize = 10.sp,
                        )
                        TextButton(onClick = { selecoes = selecoes - leg.fixtureId }, enabled = !carregando) {
                            Text("Remover", color = Color(0xFFFF8B91), fontSize = 10.sp)
                        }
                    }
                }
                if (oddMultiplaBps == null) {
                    Text("Odd total acima do limite de 1.000x.", color = Color(0xFFFFB7A7), fontSize = 10.sp)
                } else {
                    Text("Odd total ${(oddMultiplaBps / 10_000.0).format(2)}x", color = Cores.Verde, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                }
                Button(
                    onClick = {
                        val amount = valorApostaCentavos ?: return@Button
                        carregando = true
                        onApostar(pernasSelecionadas, amount, UUID.randomUUID().toString()) { error ->
                            carregando = false
                            if (error != null) {
                                erro = error.localizedMessage.orEmpty()
                            } else {
                                aviso = "Bilhete registrado. A liquidação depende do resultado de todas as seleções."
                                erro = ""
                                selecoes = emptyMap()
                                carregarDados()
                            }
                        }
                    },
                    enabled = !carregando && pernasSelecionadas.size <= 10
                        && oddMultiplaBps != null
                        && valorApostaCentavos != null && valorApostaCentavos <= 1_000_000L
                        && valorApostaCentavos <= saldoCentavos,
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(containerColor = Cores.Verde),
                ) { Text("Apostar ${pernasSelecionadas.size} seleção(ões)", color = Color(0xFF101417), fontWeight = FontWeight.Bold) }
            }
        }

        if (apostas.isNotEmpty()) {
            Spacer(Modifier.height(4.dp))
            Text("Minhas apostas", color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.Bold)
            apostas.forEach { bet ->
                Row(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(
                            if (bet.pernas.size > 1) "Múltipla · ${bet.pernas.size} seleções"
                            else "${bet.pernas.firstOrNull()?.mercadoNome ?: "Aposta esportiva"} · ${bet.pernas.firstOrNull()?.selecaoNome ?: bet.nomeSelecao}",
                            color = Color.White,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.SemiBold,
                        )
                        bet.pernas.forEach { leg ->
                            Text("${leg.mandante} x ${leg.visitante} · ${leg.selecaoNome}", color = Color.White.copy(alpha = 0.62f), fontSize = 9.sp)
                        }
                        Text(
                            if (bet.status == "open") "Pendente · odd ${(bet.oddBps / 10_000.0).format(2)}x"
                            else when (bet.resultado) {
                                "won" -> "Bilhete vencedor · prêmio ${formatarSaldoEsportivo(bet.premioCentavos)}"
                                "draw" -> "Empate · aposta perdida"
                                bet.selecao -> "Vitória · liquidada"
                                else -> "Bilhete perdido · liquidado"
                            },
                            color = if (bet.status == "open") Cores.Turquesa else Color.White.copy(alpha = 0.55f),
                            fontSize = 9.sp,
                        )
                    }
                    Text(
                        if (bet.status == "open") formatarSaldoEsportivo(bet.valorCentavos)
                        else formatarSaldoEsportivo(bet.premioCentavos),
                        color = if (bet.status == "settled" && bet.premioCentavos > 0) Cores.Verde else Color.White.copy(alpha = 0.7f),
                        fontSize = 10.sp,
                    )
                }
            }
        }
    }
}

@Composable
private fun parseValorAposta(valorTexto: String): Long? = runCatching {
    BigDecimal(valorTexto.trim().replace(',', '.')).movePointRight(2).longValueExact()
}.getOrNull()?.takeIf { it >= 100L }

private fun calcularOddMultiplaBps(pernas: List<PernaApostaEsportiva>): Long? {
    var odd = BigInteger.valueOf(10_000L)
    pernas.forEach { leg ->
        if (leg.oddBps <= 10_000) return null
        odd = odd.multiply(BigInteger.valueOf(leg.oddBps.toLong())).divide(BigInteger.valueOf(10_000L))
        if (odd > BigInteger.valueOf(10_000_000L)) return null
    }
    return odd.toLong()
}

private fun formatarSaldoEsportivo(centavos: Long): String =
    NumberFormat.getCurrencyInstance(Locale.forLanguageTag("pt-BR"))
        .format(BigDecimal.valueOf(centavos, 2))

private fun formatarHorarioEsportivo(timestampMs: Long): String =
    SimpleDateFormat("dd/MM HH:mm", Locale.forLanguageTag("pt-BR")).format(Date(timestampMs))

private fun Double.format(digits: Int): String = "%1$.${digits}f".format(Locale.ROOT, this)